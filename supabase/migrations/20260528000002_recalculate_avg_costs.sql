-- Replays a card's transaction lines in chronological order (AVCO) and writes
-- the running average cost onto each sale line's avg_cost_myr. Call after
-- mutating an import line's price/qty so downstream sales' gross profit
-- reflects the corrected cost basis. Pass NULL for p_card_external_id to
-- recalculate every card in the org.

CREATE OR REPLACE FUNCTION public.recalculate_avg_costs(
  p_org_id            uuid,
  p_card_external_id  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  rec              record;
  v_prev_card      text    := NULL;
  v_qty_in_stock   numeric := 0;
  v_cost_in_stock  numeric := 0;
  v_avg_cost       numeric;
  v_updated        integer := 0;
BEGIN
  FOR rec IN
    SELECT
      tl.id            AS line_id,
      tl.card_external_id,
      tl.side,
      COALESCE(tl.unit_price_myr, 0) AS unit_price,
      tl.qty
    FROM public.transaction_lines tl
    JOIN public.transaction t ON t.id = tl.transaction_id
    WHERE t.org_id = p_org_id
      AND t.deleted_at IS NULL
      AND tl.type = 'card'
      AND tl.card_external_id IS NOT NULL
      AND (p_card_external_id IS NULL
           OR tl.card_external_id = p_card_external_id)
    ORDER BY tl.card_external_id, t.created_at, t.id, tl.id
  LOOP
    IF rec.card_external_id IS DISTINCT FROM v_prev_card THEN
      v_qty_in_stock  := 0;
      v_cost_in_stock := 0;
      v_prev_card     := rec.card_external_id;
    END IF;

    IF rec.side = 'in' THEN
      v_qty_in_stock  := v_qty_in_stock  + rec.qty;
      v_cost_in_stock := v_cost_in_stock + rec.unit_price * rec.qty;

    ELSIF rec.side = 'out' THEN
      v_avg_cost := CASE WHEN v_qty_in_stock > 0
                         THEN v_cost_in_stock / v_qty_in_stock
                         ELSE 0 END;

      UPDATE public.transaction_lines
         SET avg_cost_myr = ROUND(v_avg_cost, 6)
       WHERE id = rec.line_id
         AND avg_cost_myr IS DISTINCT FROM ROUND(v_avg_cost, 6);

      IF FOUND THEN
        v_updated := v_updated + 1;
      END IF;

      v_cost_in_stock := GREATEST(0, v_cost_in_stock - v_avg_cost * rec.qty);
      v_qty_in_stock  := GREATEST(0, v_qty_in_stock  - rec.qty);
    END IF;
  END LOOP;

  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_avg_costs(uuid, text) TO authenticated;
