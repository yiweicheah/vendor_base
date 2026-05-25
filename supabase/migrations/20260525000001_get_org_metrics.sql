-- Global P&L / cash / stock metrics for an org.
-- Parity target: computeMetrics(transactions, miscCosts, fixedCosts) in src/lib/analytics.js.
-- All transactions are considered (no date filter for v1). All values in MYR.

CREATE OR REPLACE FUNCTION public.get_org_metrics(p_org_id uuid)
RETURNS TABLE (
  tx_count           integer,
  cash_in            numeric,
  cash_out           numeric,
  total_in           numeric,
  total_out          numeric,
  net_cash_flow      numeric,
  card_buy_qty       integer,
  card_sell_qty      integer,
  card_sold_total    integer,
  card_sold_with_cost integer,
  profit_complete    boolean,
  cogs               numeric,
  stock_qty          integer,
  stock_cost         numeric,
  stock_market       numeric,
  unrealized_gain    numeric,
  gross_profit       numeric,
  total_misc_costs   numeric,
  total_fixed_costs  numeric,
  net_pl             numeric
)
LANGUAGE sql
STABLE
AS $$
WITH
-- Live lines belonging to this org
lines AS (
  SELECT
    tl.side,
    tl.type,
    tl.card_external_id,
    tl.sealed_name,
    tl.qty,
    COALESCE(tl.unit_price_myr, 0)::numeric    AS unit_price,
    COALESCE(tl.market_price_myr, 0)::numeric  AS market_price,
    tl.avg_cost_myr,
    t.id AS tx_id,
    -- Match JS isImport: tx.notes startsWith 'Stock import' OR 'Stock addition'
    (t.notes LIKE 'Stock import%' OR t.notes LIKE 'Stock addition%') AS is_import
  FROM public.transaction t
  JOIN public.transaction_lines tl ON tl.transaction_id = t.id
  WHERE t.org_id = p_org_id
    AND t.deleted_at IS NULL
),
tx_count_cte AS (
  SELECT COUNT(DISTINCT t.id)::integer AS n
  FROM public.transaction t
  WHERE t.org_id = p_org_id AND t.deleted_at IS NULL
),
-- Cash + total_in/out + per-line buy/sell qty
cash AS (
  SELECT
    -- cash_in: type=cash, side=in
    COALESCE(SUM(CASE WHEN type='cash' AND side='in'  THEN unit_price * qty END), 0)::numeric AS cash_in,
    -- cash_out: (type=cash, side=out) + (type=card, side=in, is_import, has card_external_id)
    COALESCE(SUM(CASE WHEN type='cash' AND side='out' THEN unit_price * qty END), 0)::numeric
    + COALESCE(SUM(CASE WHEN type='card' AND side='in' AND card_external_id IS NOT NULL
                              AND is_import AND unit_price * qty > 0
                         THEN unit_price * qty END), 0)::numeric AS cash_out,
    -- total_in/out: card+sealed lines, by side
    COALESCE(SUM(CASE WHEN type IN ('card','sealed') AND side='in'
                       THEN unit_price * qty END), 0)::numeric AS total_in,
    COALESCE(SUM(CASE WHEN type IN ('card','sealed') AND side='out'
                       THEN unit_price * qty END), 0)::numeric AS total_out,
    COALESCE(SUM(CASE WHEN type='card' AND side='in'  AND card_external_id IS NOT NULL
                       THEN qty END), 0)::integer AS card_buy_qty,
    COALESCE(SUM(CASE WHEN type='card' AND side='out' AND card_external_id IS NOT NULL
                       THEN qty END), 0)::integer AS card_sell_qty
  FROM lines
),
-- Stock aggregates per card_external_id (only card lines with an id participate in stock).
-- (Sealed stock is NOT counted by computeMetrics' stockQty/stockCost — matches JS.)
stock_keys AS (
  SELECT
    card_external_id::text AS key,
    SUM(CASE WHEN side='in'  THEN qty ELSE 0 END)::integer AS qty_in,
    SUM(CASE WHEN side='out' THEN qty ELSE 0 END)::integer AS qty_out,
    SUM(CASE WHEN side='in'  THEN unit_price * qty ELSE 0 END)::numeric AS cost_in,
    SUM(CASE WHEN side='in'  THEN market_price * qty ELSE 0 END)::numeric AS market_in
  FROM lines
  WHERE type = 'card' AND card_external_id IS NOT NULL
  GROUP BY card_external_id
),
stock AS (
  SELECT
    COALESCE(SUM(CASE WHEN qty_in - qty_out > 0 AND qty_in > 0
                       THEN qty_in - qty_out END), 0)::integer AS stock_qty,
    COALESCE(SUM(CASE WHEN qty_in - qty_out > 0 AND qty_in > 0
                       THEN cost_in   * (qty_in - qty_out)::numeric / qty_in END), 0)::numeric AS stock_cost,
    COALESCE(SUM(CASE WHEN qty_in - qty_out > 0 AND qty_in > 0
                       THEN market_in * (qty_in - qty_out)::numeric / qty_in END), 0)::numeric AS stock_market
  FROM stock_keys
),
-- COGS + card_sold accumulators (per-line: only card side='out' contributes; bulk lines coalesce avg_cost to 0)
sold AS (
  SELECT
    COALESCE(SUM(CASE WHEN type='card' AND side='out' THEN qty END), 0)::integer AS card_sold_total,
    COALESCE(SUM(CASE WHEN type='card' AND side='out'
                            AND (card_external_id IS NULL OR avg_cost_myr IS NOT NULL)
                       THEN qty END), 0)::integer AS card_sold_with_cost,
    COALESCE(SUM(CASE WHEN type='card' AND side='out'
                            AND (card_external_id IS NULL OR avg_cost_myr IS NOT NULL)
                       THEN COALESCE(avg_cost_myr, 0) * qty END), 0)::numeric AS cogs
  FROM lines
),
misc AS (
  SELECT COALESCE(SUM(amount_myr), 0)::numeric AS total
  FROM public.event_misc_cost
  WHERE org_id = p_org_id
),
fixed AS (
  SELECT COALESCE(SUM(amount_myr), 0)::numeric AS total
  FROM public.fixed_cost
  WHERE org_id = p_org_id
)
SELECT
  txc.n                                                            AS tx_count,
  c.cash_in                                                        AS cash_in,
  c.cash_out                                                       AS cash_out,
  c.total_in                                                       AS total_in,
  c.total_out                                                      AS total_out,
  c.cash_in - c.cash_out                                           AS net_cash_flow,
  c.card_buy_qty                                                   AS card_buy_qty,
  c.card_sell_qty                                                  AS card_sell_qty,
  s.card_sold_total                                                AS card_sold_total,
  s.card_sold_with_cost                                            AS card_sold_with_cost,
  (s.card_sold_total = 0 OR s.card_sold_total = s.card_sold_with_cost) AS profit_complete,
  ROUND(s.cogs, 2)                                                 AS cogs,
  st.stock_qty                                                     AS stock_qty,
  ROUND(st.stock_cost,   2)                                        AS stock_cost,
  ROUND(st.stock_market, 2)                                        AS stock_market,
  ROUND(st.stock_market - st.stock_cost, 2)                        AS unrealized_gain,
  -- New global gross profit formula: totalOut + stockCost - totalIn
  ROUND(c.total_out + st.stock_cost - c.total_in, 2)               AS gross_profit,
  ROUND(m.total, 2)                                                AS total_misc_costs,
  ROUND(f.total, 2)                                                AS total_fixed_costs,
  ROUND((c.total_out + st.stock_cost - c.total_in) - m.total - f.total, 2) AS net_pl
FROM tx_count_cte txc, cash c, stock st, sold s, misc m, fixed f;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_metrics(uuid) TO authenticated;
