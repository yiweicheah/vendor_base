-- Per-event P&L / cash breakdown for an org.
-- Parity target: computeMetrics(...).eventBreakdown in src/lib/analytics.js.
-- Walk-in (NULL event_id) appears as a single row with event_id=NULL, event_name='Walk-in', sorted last.

CREATE OR REPLACE FUNCTION public.get_org_event_breakdown(p_org_id uuid)
RETURNS TABLE (
  event_id          uuid,
  event_name        text,
  tx_count          integer,
  cash_in           numeric,
  cash_out          numeric,
  total_in          numeric,
  total_out         numeric,
  net_cash_flow     numeric,
  gross_profit      numeric,
  card_sold_total   integer,
  profit_complete   boolean,
  misc_cost_total   numeric,
  net_pl            numeric
)
LANGUAGE sql
STABLE
AS $$
WITH
lines AS (
  SELECT
    t.event_id,
    e.name AS event_name,
    t.id AS tx_id,
    tl.side, tl.type, tl.card_external_id,
    tl.qty,
    COALESCE(tl.unit_price_myr, 0)::numeric AS unit_price,
    tl.avg_cost_myr,
    (t.notes LIKE 'Stock import%' OR t.notes LIKE 'Stock addition%') AS is_import
  FROM public.transaction t
  JOIN public.transaction_lines tl ON tl.transaction_id = t.id
  LEFT JOIN public.event e ON e.id = t.event_id
  WHERE t.org_id = p_org_id
    AND t.deleted_at IS NULL
),
tx_per_event AS (
  SELECT t.event_id, COUNT(*)::integer AS n
  FROM public.transaction t
  WHERE t.org_id = p_org_id AND t.deleted_at IS NULL
  GROUP BY t.event_id
),
agg AS (
  SELECT
    l.event_id,
    MAX(l.event_name) AS event_name,
    COALESCE(SUM(CASE WHEN type='cash' AND side='in'  THEN unit_price * qty END), 0)::numeric AS cash_in,
    COALESCE(SUM(CASE WHEN type='cash' AND side='out' THEN unit_price * qty END), 0)::numeric
    + COALESCE(SUM(CASE WHEN type='card' AND side='in' AND card_external_id IS NOT NULL
                              AND is_import AND unit_price * qty > 0
                         THEN unit_price * qty END), 0)::numeric AS cash_out,
    COALESCE(SUM(CASE WHEN type IN ('card','sealed') AND side='in'
                       THEN unit_price * qty END), 0)::numeric AS total_in,
    COALESCE(SUM(CASE WHEN type IN ('card','sealed') AND side='out'
                       THEN unit_price * qty END), 0)::numeric AS total_out,
    COALESCE(SUM(CASE WHEN type='card' AND side='out' THEN qty END), 0)::integer AS card_sold_total,
    COALESCE(SUM(CASE WHEN type='card' AND side='out'
                            AND (card_external_id IS NULL OR avg_cost_myr IS NOT NULL)
                       THEN qty END), 0)::integer AS card_sold_with_cost,
    -- Per-event gross profit: sum over card side='out' of (unit_price - effective_cost) * qty
    COALESCE(SUM(CASE WHEN type='card' AND side='out'
                            AND (card_external_id IS NULL OR avg_cost_myr IS NOT NULL)
                       THEN (unit_price - COALESCE(avg_cost_myr, 0)) * qty END), 0)::numeric AS gross_profit
  FROM lines l
  GROUP BY l.event_id
),
misc_per_event AS (
  SELECT event_id, COALESCE(SUM(amount_myr), 0)::numeric AS total
  FROM public.event_misc_cost
  WHERE org_id = p_org_id
  GROUP BY event_id
)
SELECT
  COALESCE(a.event_id, t.event_id)               AS event_id,
  COALESCE(a.event_name, 'Walk-in')              AS event_name,
  COALESCE(t.n, 0)                                AS tx_count,
  COALESCE(a.cash_in,   0)                        AS cash_in,
  COALESCE(a.cash_out,  0)                        AS cash_out,
  COALESCE(a.total_in,  0)                        AS total_in,
  COALESCE(a.total_out, 0)                        AS total_out,
  COALESCE(a.cash_in,   0) - COALESCE(a.cash_out, 0) AS net_cash_flow,
  ROUND(COALESCE(a.gross_profit, 0), 2)           AS gross_profit,
  COALESCE(a.card_sold_total, 0)                  AS card_sold_total,
  (COALESCE(a.card_sold_total, 0) = 0
    OR COALESCE(a.card_sold_total, 0) = COALESCE(a.card_sold_with_cost, 0)) AS profit_complete,
  ROUND(COALESCE(m.total, 0), 2)                  AS misc_cost_total,
  ROUND(COALESCE(a.gross_profit, 0) - COALESCE(m.total, 0), 2) AS net_pl
FROM tx_per_event t
FULL OUTER JOIN agg a USING (event_id)
LEFT JOIN misc_per_event m ON m.event_id = COALESCE(a.event_id, t.event_id)
ORDER BY
  CASE WHEN COALESCE(a.event_id, t.event_id) IS NULL THEN 1 ELSE 0 END,
  tx_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_event_breakdown(uuid) TO authenticated;
