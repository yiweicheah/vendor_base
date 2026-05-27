-- Bulk-insert transaction lines for an org. Powers ImportModal's confirm step,
-- replacing the per-line Promise.all(saveTransactionLine) loop with a single RPC.
--
-- Each element of p_lines is the snake-cased shape that saveTransactionLine
-- accepts (minus transaction_id, which is server-set from p_transaction_id).
-- The transaction must belong to p_org_id and not be soft-deleted — otherwise
-- the function raises so a stale or cross-org id can't smuggle lines through.

CREATE OR REPLACE FUNCTION public.bulk_upsert_transaction_lines(
  p_org_id         uuid,
  p_transaction_id uuid,
  p_lines          jsonb
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.transaction
    WHERE id = p_transaction_id
      AND org_id = p_org_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Transaction % does not belong to org % or is deleted',
      p_transaction_id, p_org_id;
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.transaction_lines (
    transaction_id,
    side,
    type,
    qty,
    unit_price_myr,
    card_external_id,
    card_name,
    card_number,
    card_set_name,
    card_lang,
    card_image_url,
    market_price_myr,
    price_source,
    usd_to_myr_rate,
    eur_to_myr_rate,
    sealed_product_id,
    sealed_name,
    sealed_reference_price,
    sealed_catalog_id,
    avg_cost_myr
  )
  SELECT
    p_transaction_id,
    el->>'side',
    el->>'type',
    (el->>'qty')::integer,
    NULLIF(el->>'unit_price_myr', '')::numeric,
    el->>'card_external_id',
    el->>'card_name',
    el->>'card_number',
    el->>'card_set_name',
    el->>'card_lang',
    el->>'card_image_url',
    NULLIF(el->>'market_price_myr', '')::numeric,
    el->>'price_source',
    NULLIF(el->>'usd_to_myr_rate', '')::numeric,
    NULLIF(el->>'eur_to_myr_rate', '')::numeric,
    NULLIF(el->>'sealed_product_id', '')::uuid,
    el->>'sealed_name',
    NULLIF(el->>'sealed_reference_price', '')::numeric,
    NULLIF(el->>'sealed_catalog_id', '')::uuid,
    NULLIF(el->>'avg_cost_myr', '')::numeric
  FROM jsonb_array_elements(p_lines) AS el
  RETURNING id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_upsert_transaction_lines(uuid, uuid, jsonb) TO authenticated;
