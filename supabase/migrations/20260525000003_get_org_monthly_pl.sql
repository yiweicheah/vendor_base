-- Month-by-month P&L using opening/closing stock equation:
--   gross_profit = revenue − opening_stock − purchases + closing_stock
-- Parity target: computeMonthlyPL(...) in src/lib/analytics.js,
--   called once per month from Dashboard. Returns one row per month found
--   in the union of (tx months) ∪ (misc-cost months) ∪ (fixed-cost months).
-- All time bucketing uses UTC YYYY-MM strings, matching the JS slice(0,7) of
-- raw timestamptz ISO strings returned from PostgREST.

CREATE OR REPLACE FUNCTION public.get_org_monthly_pl(p_org_id uuid)
RETURNS TABLE (
  month          text,
  tx_count       integer,
  card_buy_qty   integer,
  card_sell_qty  integer,
  revenue        numeric,
  purchases      numeric,
  opening_stock  numeric,
  closing_stock  numeric,
  gross_profit   numeric,
  misc_costs     numeric,
  fixed_costs    numeric,
  net_pl         numeric
)
LANGUAGE sql
STABLE
AS $$
WITH
-- Stock-bearing lines (cards with id + sealed by name), tagged with their UTC month.
keyed_lines AS (
  SELECT
    CASE
      WHEN tl.type='card'   AND tl.card_external_id IS NOT NULL THEN 'card:'   || tl.card_external_id
      WHEN tl.type='sealed' AND tl.sealed_name      IS NOT NULL THEN 'sealed:' || lower(tl.sealed_name)
    END AS key,
    to_char((t.created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM') AS line_ym,
    tl.side,
    tl.qty,
    COALESCE(tl.unit_price_myr, 0)::numeric AS unit_price
  FROM public.transaction t
  JOIN public.transaction_lines tl ON tl.transaction_id = t.id
  WHERE t.org_id = p_org_id
    AND t.deleted_at IS NULL
    AND (
      (tl.type='card'   AND tl.card_external_id IS NOT NULL) OR
      (tl.type='sealed' AND tl.sealed_name      IS NOT NULL)
    )
),
-- Per (key, month) delta in qty_in, qty_out, cost_in.
month_deltas_per_key AS (
  SELECT
    key,
    line_ym,
    COALESCE(SUM(CASE WHEN side='in'  THEN qty END), 0)::integer AS qty_in_delta,
    COALESCE(SUM(CASE WHEN side='out' THEN qty END), 0)::integer AS qty_out_delta,
    COALESCE(SUM(CASE WHEN side='in'  THEN unit_price * qty END), 0)::numeric AS cost_in_delta
  FROM keyed_lines
  GROUP BY key, line_ym
),
-- Source months: any month that appears in transactions, misc costs, or fixed costs.
source_months AS (
  SELECT to_char((t.created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM') AS ym
  FROM public.transaction t
  WHERE t.org_id = p_org_id AND t.deleted_at IS NULL

  UNION
  SELECT to_char((COALESCE(e.starts_at, c.created_at) AT TIME ZONE 'UTC')::date, 'YYYY-MM')
  FROM public.event_misc_cost c
  LEFT JOIN public.event e ON e.id = c.event_id
  WHERE c.org_id = p_org_id

  UNION
  SELECT to_char(c.month, 'YYYY-MM')
  FROM public.fixed_cost c
  WHERE c.org_id = p_org_id
),
source_months_clean AS (
  SELECT DISTINCT ym FROM source_months WHERE ym IS NOT NULL AND ym <> ''
),
-- For opening-stock lookup we may need a month one position before any source month.
month_universe AS (
  SELECT ym FROM source_months_clean
  UNION
  SELECT
    CASE
      WHEN substring(ym, 6, 2) = '01'
        THEN (substring(ym, 1, 4)::int - 1)::text || '-12'
      ELSE substring(ym, 1, 4) || '-' || lpad((substring(ym, 6, 2)::int - 1)::text, 2, '0')
    END
  FROM source_months_clean
),
all_months AS (SELECT DISTINCT ym FROM month_universe),
keys_distinct AS (SELECT DISTINCT key FROM month_deltas_per_key),
-- Cross-join keys × months and zero-fill so window functions get a row at every month.
key_x_months AS (
  SELECT k.key, m.ym
  FROM keys_distinct k CROSS JOIN all_months m
),
key_x_months_with_deltas AS (
  SELECT
    kxm.key,
    kxm.ym,
    COALESCE(d.qty_in_delta,   0) AS qty_in_delta,
    COALESCE(d.qty_out_delta,  0) AS qty_out_delta,
    COALESCE(d.cost_in_delta,  0::numeric) AS cost_in_delta
  FROM key_x_months kxm
  LEFT JOIN month_deltas_per_key d
    ON d.key = kxm.key AND d.line_ym = kxm.ym
),
-- Cumulative state per (key, month) — equivalent to the JS stockCostAt(endYM) walk.
running AS (
  SELECT
    key, ym,
    SUM(qty_in_delta)  OVER w AS run_qty_in,
    SUM(qty_out_delta) OVER w AS run_qty_out,
    SUM(cost_in_delta) OVER w AS run_cost_in
  FROM key_x_months_with_deltas
  WINDOW w AS (PARTITION BY key ORDER BY ym ROWS UNBOUNDED PRECEDING)
),
-- Pro-rata cost: cost_in * (net / qty_in) when net > 0 and qty_in > 0.
stock_per_month AS (
  SELECT
    ym,
    COALESCE(SUM(
      CASE
        WHEN run_qty_in - run_qty_out > 0 AND run_qty_in > 0
          THEN run_cost_in * (run_qty_in - run_qty_out)::numeric / run_qty_in
        ELSE 0
      END
    ), 0)::numeric AS stock_cost
  FROM running
  GROUP BY ym
),
-- Per-month transaction totals (counts EVERY card line incl. bulk, matching JS).
tx_per_month AS (
  SELECT
    to_char((t.created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM') AS ym,
    COUNT(DISTINCT t.id)::integer AS tx_count,
    COALESCE(SUM(CASE WHEN tl.type IN ('card','sealed') AND tl.side='out'
                       THEN COALESCE(tl.unit_price_myr, 0) * tl.qty END), 0)::numeric AS revenue,
    COALESCE(SUM(CASE WHEN tl.type IN ('card','sealed') AND tl.side='in'
                       THEN COALESCE(tl.unit_price_myr, 0) * tl.qty END), 0)::numeric AS purchases,
    COALESCE(SUM(CASE WHEN tl.type='card' AND tl.side='in'  THEN tl.qty END), 0)::integer AS card_buy_qty,
    COALESCE(SUM(CASE WHEN tl.type='card' AND tl.side='out' THEN tl.qty END), 0)::integer AS card_sell_qty
  FROM public.transaction t
  LEFT JOIN public.transaction_lines tl ON tl.transaction_id = t.id
  WHERE t.org_id = p_org_id AND t.deleted_at IS NULL
  GROUP BY ym
),
-- Misc costs attributed by event.starts_at month, fallback to cost.created_at.
misc_per_month AS (
  SELECT
    to_char((COALESCE(e.starts_at, c.created_at) AT TIME ZONE 'UTC')::date, 'YYYY-MM') AS ym,
    COALESCE(SUM(c.amount_myr), 0)::numeric AS amount
  FROM public.event_misc_cost c
  LEFT JOIN public.event e ON e.id = c.event_id
  WHERE c.org_id = p_org_id
  GROUP BY ym
),
fixed_per_month AS (
  SELECT
    to_char(c.month, 'YYYY-MM') AS ym,
    COALESCE(SUM(c.amount_myr), 0)::numeric AS amount
  FROM public.fixed_cost c
  WHERE c.org_id = p_org_id
  GROUP BY ym
),
-- For each *source* month, compute prev_ym for opening_stock lookup.
months_with_prev AS (
  SELECT
    ym,
    CASE
      WHEN substring(ym, 6, 2) = '01'
        THEN (substring(ym, 1, 4)::int - 1)::text || '-12'
      ELSE substring(ym, 1, 4) || '-' || lpad((substring(ym, 6, 2)::int - 1)::text, 2, '0')
    END AS prev_ym
  FROM source_months_clean
)
SELECT
  m.ym                                                                            AS month,
  COALESCE(tpm.tx_count,      0)                                                  AS tx_count,
  COALESCE(tpm.card_buy_qty,  0)                                                  AS card_buy_qty,
  COALESCE(tpm.card_sell_qty, 0)                                                  AS card_sell_qty,
  ROUND(COALESCE(tpm.revenue,        0), 2)                                       AS revenue,
  ROUND(COALESCE(tpm.purchases,      0), 2)                                       AS purchases,
  ROUND(COALESCE(prev_spm.stock_cost, 0), 2)                                      AS opening_stock,
  ROUND(COALESCE(spm.stock_cost,      0), 2)                                      AS closing_stock,
  ROUND(
    COALESCE(tpm.revenue,        0)
    - COALESCE(prev_spm.stock_cost, 0)
    - COALESCE(tpm.purchases,    0)
    + COALESCE(spm.stock_cost,    0)
  , 2)                                                                            AS gross_profit,
  ROUND(COALESCE(mpm.amount, 0), 2)                                               AS misc_costs,
  ROUND(COALESCE(fpm.amount, 0), 2)                                               AS fixed_costs,
  ROUND(
    (COALESCE(tpm.revenue,        0)
     - COALESCE(prev_spm.stock_cost, 0)
     - COALESCE(tpm.purchases,    0)
     + COALESCE(spm.stock_cost,    0))
    - COALESCE(mpm.amount, 0)
    - COALESCE(fpm.amount, 0)
  , 2)                                                                            AS net_pl
FROM months_with_prev m
LEFT JOIN tx_per_month    tpm      ON tpm.ym      = m.ym
LEFT JOIN stock_per_month spm      ON spm.ym      = m.ym
LEFT JOIN stock_per_month prev_spm ON prev_spm.ym = m.prev_ym
LEFT JOIN misc_per_month  mpm      ON mpm.ym      = m.ym
LEFT JOIN fixed_per_month fpm      ON fpm.ym      = m.ym
ORDER BY m.ym;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_monthly_pl(uuid) TO authenticated;
