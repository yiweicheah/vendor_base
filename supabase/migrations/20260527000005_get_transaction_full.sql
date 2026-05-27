-- Lazy-load companion to the slim get_org_transactions_page. Returns the full
-- transaction_lines array for one transaction so TransactionCard can populate
-- its expanded view on demand. The slim page RPC no longer ships lines, so
-- this RPC fires exactly when a user clicks Expand (and after any line-level
-- mutation, to refresh the local view).
--
-- Validates the tx belongs to the requesting org and isn't soft-deleted so
-- a cross-org id can't smuggle lines through.

CREATE OR REPLACE FUNCTION public.get_transaction_full(
  p_org_id uuid,
  p_tx_id  uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
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
  )), '[]'::jsonb)
  FROM public.transaction_lines tl
  WHERE tl.transaction_id = p_tx_id
    AND EXISTS (
      SELECT 1 FROM public.transaction t
      WHERE t.id = p_tx_id
        AND t.org_id = p_org_id
        AND t.deleted_at IS NULL
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_transaction_full(uuid, uuid) TO authenticated;
