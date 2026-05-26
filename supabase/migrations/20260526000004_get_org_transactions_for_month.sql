-- All transactions in a given calendar month (UTC) for an org, with their lines.
-- Powers the Export P&L modal on the Dashboard, which writes per-line CSV rows.
-- Lets us drop the global loadTransactions blob — the only remaining consumer
-- of the in-memory transactions[] array was this export flow.
--
-- p_year_month is a 'YYYY-MM' string matching JS's tx.createdAt.slice(0,7).
-- Result shape mirrors loadTransactions() / get_org_transactions_page rows;
-- the JS wrapper applies toCamel.

CREATE OR REPLACE FUNCTION public.get_org_transactions_for_month(
  p_org_id      uuid,
  p_year_month  text
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
SELECT COALESCE(jsonb_agg(
  jsonb_build_object(
    'id',              t.id,
    'created_at',      t.created_at,
    'notes',           t.notes,
    'payment_method',  t.payment_method,
    'event',           CASE WHEN t.event_id IS NOT NULL
                             THEN jsonb_build_object('id', t.event_id, 'name', e.name)
                             END,
    'created_by',      CASE WHEN u.display_name IS NOT NULL
                             THEN jsonb_build_object('display_name', u.display_name)
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
      WHERE tl.transaction_id = t.id
    ), '[]'::jsonb)
  )
  ORDER BY t.created_at DESC, t.id DESC
), '[]'::jsonb)
FROM public.transaction t
LEFT JOIN public.event e   ON e.id = t.event_id
LEFT JOIN public."user" u  ON u.id = t.created_by_id
WHERE t.org_id = p_org_id
  AND t.deleted_at IS NULL
  AND to_char((t.created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM') = p_year_month;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_transactions_for_month(uuid, text) TO authenticated;
