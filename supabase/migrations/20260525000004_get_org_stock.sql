-- get_org_stock: server-side equivalent of buildStockMap(transactions) in src/lib/analytics.js.
-- Returns one row per in-stock key (cards by card_external_id, sealed by lower(sealed_name)).
-- Optional event filter: pass p_event_id for a specific event, or p_filter_walk_ins=true for
-- transactions with no event link. Default (both null/false) returns global stock.

CREATE OR REPLACE FUNCTION public.get_org_stock(
  p_org_id          uuid,
  p_event_id        uuid    DEFAULT NULL,
  p_filter_walk_ins boolean DEFAULT false
)
RETURNS TABLE (
  type      text,
  key       text,
  name      text,
  number    text,
  set_name  text,
  lang      text,
  image_url text,
  qty_in    bigint,
  qty_out   bigint,
  cost_in   numeric,
  market_in numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  -- Card aggregates
  SELECT
    'card'::text                                                       AS type,
    tl.card_external_id::text                                          AS key,
    min(CASE WHEN tl.side = 'in' THEN tl.card_name     END)            AS name,
    min(CASE WHEN tl.side = 'in' THEN tl.card_number   END)            AS number,
    min(CASE WHEN tl.side = 'in' THEN tl.card_set_name END)            AS set_name,
    min(CASE WHEN tl.side = 'in' THEN tl.card_lang     END)            AS lang,
    min(CASE WHEN tl.side = 'in' THEN tl.card_image_url END)           AS image_url,
    sum(CASE WHEN tl.side = 'in'  THEN tl.qty ELSE 0 END)::bigint      AS qty_in,
    sum(CASE WHEN tl.side = 'out' THEN tl.qty ELSE 0 END)::bigint      AS qty_out,
    sum(CASE WHEN tl.side = 'in'  THEN tl.unit_price_myr * tl.qty ELSE 0 END)                 AS cost_in,
    sum(CASE WHEN tl.side = 'in'  THEN coalesce(tl.market_price_myr, 0) * tl.qty ELSE 0 END)  AS market_in
  FROM transaction_lines tl
  JOIN transaction t ON t.id = tl.transaction_id
  WHERE t.org_id = p_org_id
    AND t.deleted_at IS NULL
    AND tl.type = 'card'
    AND tl.card_external_id IS NOT NULL
    AND (
      (p_event_id IS NULL AND NOT p_filter_walk_ins)
      OR (p_event_id IS NOT NULL AND t.event_id = p_event_id)
      OR (p_filter_walk_ins AND t.event_id IS NULL)
    )
  GROUP BY tl.card_external_id
  HAVING sum(CASE WHEN tl.side = 'in' THEN tl.qty ELSE -tl.qty END) > 0

  UNION ALL

  -- Sealed aggregates
  SELECT
    'sealed'::text                                                     AS type,
    lower(tl.sealed_name)                                              AS key,
    min(tl.sealed_name)                                                AS name,
    NULL::text                                                         AS number,
    NULL::text                                                         AS set_name,
    NULL::text                                                         AS lang,
    NULL::text                                                         AS image_url,
    sum(CASE WHEN tl.side = 'in'  THEN tl.qty ELSE 0 END)::bigint      AS qty_in,
    sum(CASE WHEN tl.side = 'out' THEN tl.qty ELSE 0 END)::bigint      AS qty_out,
    sum(CASE WHEN tl.side = 'in'  THEN tl.unit_price_myr * tl.qty ELSE 0 END)                 AS cost_in,
    0::numeric                                                         AS market_in
  FROM transaction_lines tl
  JOIN transaction t ON t.id = tl.transaction_id
  WHERE t.org_id = p_org_id
    AND t.deleted_at IS NULL
    AND tl.type = 'sealed'
    AND tl.sealed_name IS NOT NULL
    AND (
      (p_event_id IS NULL AND NOT p_filter_walk_ins)
      OR (p_event_id IS NOT NULL AND t.event_id = p_event_id)
      OR (p_filter_walk_ins AND t.event_id IS NULL)
    )
  GROUP BY lower(tl.sealed_name)
  HAVING sum(CASE WHEN tl.side = 'in' THEN tl.qty ELSE -tl.qty END) > 0
$$;

GRANT EXECUTE ON FUNCTION public.get_org_stock(uuid, uuid, boolean) TO authenticated;
