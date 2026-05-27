-- Bulk-update transaction lines (price / qty) for History edits. Powers
-- TransactionCard's handleSave, replacing the per-line updateTransactionLine
-- PATCH loop with a single RPC.
--
-- Each element of p_lines is { id, unit_price_myr?, qty? } — only the fields
-- that changed are included. COALESCE preserves the existing value for any
-- omitted field. Cross-org or stale ids would silently filter out of the
-- UPDATE, so a ROW_COUNT check raises when fewer rows were updated than
-- patches were sent.

CREATE OR REPLACE FUNCTION public.update_transaction_lines_bulk(
  p_org_id uuid,
  p_lines  jsonb
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  expected integer;
  actual   integer;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RETURN;
  END IF;

  expected := jsonb_array_length(p_lines);

  RETURN QUERY
  WITH patches AS (
    SELECT
      (el->>'id')::uuid                              AS id,
      NULLIF(el->>'unit_price_myr','')::numeric      AS unit_price_myr,
      NULLIF(el->>'qty','')::integer                 AS qty
    FROM jsonb_array_elements(p_lines) AS el
  ),
  upd AS (
    UPDATE public.transaction_lines tl
    SET
      unit_price_myr = COALESCE(p.unit_price_myr, tl.unit_price_myr),
      qty            = COALESCE(p.qty,            tl.qty)
    FROM patches p
    WHERE tl.id = p.id
      AND EXISTS (
        SELECT 1 FROM public.transaction t
        WHERE t.id = tl.transaction_id
          AND t.org_id = p_org_id
          AND t.deleted_at IS NULL
      )
    RETURNING tl.id
  )
  SELECT id FROM upd;

  GET DIAGNOSTICS actual = ROW_COUNT;
  IF actual <> expected THEN
    RAISE EXCEPTION 'update_transaction_lines_bulk: % patches sent but % rows updated (cross-org or stale ids)',
      expected, actual;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_transaction_lines_bulk(uuid, jsonb) TO authenticated;
