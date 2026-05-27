-- Slim header-only variant of get_org_transactions_page. The previous version
-- embedded the full transaction_lines jsonb array on every row of every page,
-- shipping 100s of line objects just to render collapsed History summaries.
-- This version precomputes every scalar TransactionCard's collapsed row needs
-- (totals, qty counts, classification, mini P&L) directly on the aggregate
-- and drops the per-tx lines subquery entirely. The expanded view lazy-loads
-- via the new get_transaction_full RPC.
--
-- Aggregate fields mirror what TransactionCard derived in JS:
--   in_total / out_total       — SUM(unit_price*qty) per side (any type)
--   card_in_total / card_out_total — SUM(unit_price*qty) per side, type IN (card,sealed)
--   card_in_qty / card_out_qty — SUM(qty) per side, type='card' only (matches
--                                JS cardCountIn/cardCountOut)
--   has_cash_in / has_cash_out — bool, presence of cash line per side
--   card_sold_total / gross_profit / profit_complete — match JS txMetrics:
--       cards only (sealed excluded); for cardExternalId IS NULL treat
--       avg_cost as 0; profit_complete iff every sold card has cost basis
--       (avg_cost_myr set OR card_external_id NULL)
--
-- Return-shape change vs. 20260526000002: DROP FUNCTION IF EXISTS first.

DROP FUNCTION IF EXISTS public.get_org_transactions_page(uuid, uuid, boolean, text, text, text, text, int, int);

CREATE OR REPLACE FUNCTION public.get_org_transactions_page(
  p_org_id          uuid,
  p_event_id        uuid    DEFAULT NULL,
  p_filter_walk_ins boolean DEFAULT FALSE,
  p_type            text    DEFAULT NULL,
  p_creator_name    text    DEFAULT NULL,
  p_payment_method  text    DEFAULT NULL,
  p_sort            text    DEFAULT 'date',
  p_offset          int     DEFAULT 0,
  p_limit           int     DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH tx_aggs AS (
  SELECT
    t.id,
    t.created_at,
    t.notes,
    t.payment_method,
    t.event_id,
    t.created_by_id,
    COALESCE(SUM(tl.unit_price_myr * tl.qty), 0)::numeric                              AS total_value,
    COALESCE(MAX(tl.unit_price_myr), 0)::numeric                                       AS max_unit_price,
    COALESCE(bool_or(tl.side = 'in'  AND tl.type IN ('card','sealed')), FALSE)         AS cards_in,
    COALESCE(bool_or(tl.side = 'in'  AND tl.type = 'cash'),              FALSE)        AS has_cash_in,
    COALESCE(bool_or(tl.side = 'out' AND tl.type IN ('card','sealed')), FALSE)         AS cards_out,
    COALESCE(bool_or(tl.side = 'out' AND tl.type = 'cash'),              FALSE)        AS has_cash_out,
    -- Slim-payload scalars (TransactionCard collapsed row reads these directly)
    COALESCE(SUM(CASE WHEN tl.side = 'in'  THEN tl.unit_price_myr * tl.qty END), 0)::numeric        AS in_total,
    COALESCE(SUM(CASE WHEN tl.side = 'out' THEN tl.unit_price_myr * tl.qty END), 0)::numeric        AS out_total,
    COALESCE(SUM(CASE WHEN tl.side = 'in'  AND tl.type IN ('card','sealed')
                       THEN tl.unit_price_myr * tl.qty END), 0)::numeric                            AS card_in_total,
    COALESCE(SUM(CASE WHEN tl.side = 'out' AND tl.type IN ('card','sealed')
                       THEN tl.unit_price_myr * tl.qty END), 0)::numeric                            AS card_out_total,
    COALESCE(SUM(CASE WHEN tl.side = 'in'  AND tl.type = 'card' THEN tl.qty END), 0)::int           AS card_in_qty,
    COALESCE(SUM(CASE WHEN tl.side = 'out' AND tl.type = 'card' THEN tl.qty END), 0)::int           AS card_out_qty,
    -- Mini P&L (cards only, matches JS txMetrics)
    COALESCE(SUM(CASE
      WHEN tl.side = 'out' AND tl.type = 'card'
           AND (tl.card_external_id IS NULL OR tl.avg_cost_myr IS NOT NULL)
        THEN ((tl.unit_price_myr) - COALESCE(tl.avg_cost_myr, 0)) * tl.qty
    END), 0)::numeric                                                                               AS gross_profit_raw,
    COALESCE(SUM(CASE
      WHEN tl.side = 'out' AND tl.type = 'card'
           AND (tl.card_external_id IS NULL OR tl.avg_cost_myr IS NOT NULL)
        THEN tl.qty
    END), 0)::int                                                                                   AS card_sold_with_cost
  FROM public.transaction t
  LEFT JOIN public.transaction_lines tl ON tl.transaction_id = t.id
  WHERE t.org_id = p_org_id
    AND t.deleted_at IS NULL
  GROUP BY t.id
),
tx_classified AS (
  SELECT
    a.*,
    CASE
      WHEN a.notes LIKE 'Stock import%' OR a.notes LIKE 'Stock addition%'             THEN 'BUY'
      WHEN a.cards_in AND a.has_cash_out AND NOT a.has_cash_in AND NOT a.cards_out    THEN 'BUY'
      WHEN a.has_cash_in AND a.cards_out AND NOT a.cards_in AND NOT a.has_cash_out    THEN 'SELL'
      ELSE 'TRADE'
    END AS tx_type,
    ROUND(a.gross_profit_raw, 2)                                                       AS gross_profit,
    (a.card_out_qty = 0 OR a.card_out_qty = a.card_sold_with_cost)                     AS profit_complete
  FROM tx_aggs a
),
tx_filtered AS (
  SELECT
    tc.*,
    e.name           AS event_name,
    u.display_name   AS creator_name
  FROM tx_classified tc
  LEFT JOIN public.event e   ON e.id = tc.event_id
  LEFT JOIN public."user" u  ON u.id = tc.created_by_id
  WHERE (p_event_id        IS NULL OR tc.event_id      = p_event_id)
    AND (NOT p_filter_walk_ins    OR tc.event_id IS NULL)
    AND (p_type            IS NULL OR tc.tx_type       = p_type)
    AND (p_creator_name    IS NULL OR u.display_name   = p_creator_name)
    AND (p_payment_method  IS NULL OR tc.payment_method = p_payment_method)
),
tx_sorted AS (
  SELECT
    tf.*,
    ROW_NUMBER() OVER (ORDER BY
      CASE WHEN p_sort = 'total' THEN tf.total_value    END DESC NULLS LAST,
      CASE WHEN p_sort = 'unit'  THEN tf.max_unit_price END DESC NULLS LAST,
      tf.created_at DESC,
      tf.id         DESC
    ) AS rn
  FROM tx_filtered tf
),
tx_page AS (
  SELECT * FROM tx_sorted
  WHERE rn > p_offset AND rn <= p_offset + p_limit
)
SELECT jsonb_build_object(
  'rows', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',              tp.id,
        'created_at',      tp.created_at,
        'notes',           tp.notes,
        'payment_method',  tp.payment_method,
        'event',           CASE WHEN tp.event_id IS NOT NULL
                                 THEN jsonb_build_object('id', tp.event_id, 'name', tp.event_name)
                                 END,
        'created_by',      CASE WHEN tp.creator_name IS NOT NULL
                                 THEN jsonb_build_object('display_name', tp.creator_name)
                                 END,
        'tx_type',         tp.tx_type,
        'in_total',        tp.in_total,
        'out_total',       tp.out_total,
        'card_in_total',   tp.card_in_total,
        'card_out_total',  tp.card_out_total,
        'card_in_qty',     tp.card_in_qty,
        'card_out_qty',    tp.card_out_qty,
        'has_cash_in',     tp.has_cash_in,
        'has_cash_out',    tp.has_cash_out,
        'card_sold_total', tp.card_out_qty,
        'gross_profit',    tp.gross_profit,
        'profit_complete', tp.profit_complete
      )
      ORDER BY tp.rn
    )
    FROM tx_page tp
  ), '[]'::jsonb),
  'total_count', (SELECT COUNT(*)::int FROM tx_filtered)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_org_transactions_page(uuid, uuid, boolean, text, text, text, text, int, int) TO authenticated;
