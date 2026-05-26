-- Paginated transaction list for the History page.
-- Mirrors loadTransactions() in src/lib/db.js (id, createdAt, notes, paymentMethod,
-- event, createdBy, transactionLines) but applies filters + sort + offset server-side
-- so the client never has to hold the full transactions array in memory.
--
-- Filters are NULL-or-equals: pass NULL on the JS side to disable a given filter.
-- Event filter has three states:
--   p_event_id != NULL                  → only that event
--   p_filter_walk_ins = true            → only transactions with no event link
--   both NULL/false (default)           → no event filter (all events + walk-ins)
-- Type filter ('BUY' / 'SELL' / 'TRADE') classifies each tx via the same rules as
-- classifyTransaction() in src/components/History/TransactionCard.jsx — sealed lines
-- count as merchandise alongside cards; stock-import notes always map to 'BUY'.
-- Sort options: 'date' (created_at DESC, default), 'total' (sum of line value DESC),
-- 'unit' (max line unit price DESC). All sorts tiebreak on (created_at, id) DESC.
--
-- Result shape: { rows: [...], total_count: int }. JS layer applies toCamel.

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
    COALESCE(bool_or(tl.side = 'in'  AND tl.type = 'cash'),              FALSE)        AS cash_in,
    COALESCE(bool_or(tl.side = 'out' AND tl.type IN ('card','sealed')), FALSE)         AS cards_out,
    COALESCE(bool_or(tl.side = 'out' AND tl.type = 'cash'),              FALSE)        AS cash_out
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
      WHEN a.notes LIKE 'Stock import%' OR a.notes LIKE 'Stock addition%'   THEN 'BUY'
      WHEN a.cards_in AND a.cash_out AND NOT a.cash_in AND NOT a.cards_out  THEN 'BUY'
      WHEN a.cash_in  AND a.cards_out AND NOT a.cards_in AND NOT a.cash_out THEN 'SELL'
      ELSE 'TRADE'
    END AS tx_type
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
        'transaction_lines', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',                     tl.id,
            'side',                   tl.side,
            'type',                   tl.type,
            'qty',                    tl.qty,
            'unit_price_myr',         tl.unit_price_myr,
            'card_external_id',       tl.card_external_id,
            'card_name',              tl.card_name,
            'card_number',            tl.card_number,
            'card_set_name',          tl.card_set_name,
            'card_lang',              tl.card_lang,
            'card_image_url',         tl.card_image_url,
            'avg_cost_myr',           tl.avg_cost_myr,
            'market_price_myr',       tl.market_price_myr,
            'price_source',           tl.price_source,
            'sealed_name',            tl.sealed_name,
            'sealed_reference_price', tl.sealed_reference_price,
            'sealed_catalog_id',      tl.sealed_catalog_id
          ))
          FROM public.transaction_lines tl
          WHERE tl.transaction_id = tp.id
        ), '[]'::jsonb)
      )
      ORDER BY tp.rn
    )
    FROM tx_page tp
  ), '[]'::jsonb),
  'total_count', (SELECT COUNT(*)::int FROM tx_filtered)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_org_transactions_page(uuid, uuid, boolean, text, text, text, text, int, int) TO authenticated;
