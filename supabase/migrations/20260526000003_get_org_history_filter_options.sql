-- Distinct creator display names + payment methods that actually appear in an org's
-- non-deleted transactions. Powers the History page's creator + payment filter
-- dropdowns once it no longer has the full transactions array in memory.
--
-- Also returns has_any so History can distinguish "org has no transactions"
-- (show empty state) from "no transactions match the current filter".

CREATE OR REPLACE FUNCTION public.get_org_history_filter_options(p_org_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
SELECT jsonb_build_object(
  'creators', COALESCE((
    SELECT jsonb_agg(name ORDER BY name)
    FROM (
      SELECT DISTINCT u.display_name AS name
      FROM public.transaction t
      JOIN public."user" u ON u.id = t.created_by_id
      WHERE t.org_id = p_org_id
        AND t.deleted_at IS NULL
        AND u.display_name IS NOT NULL
    ) c
  ), '[]'::jsonb),
  'payment_methods', COALESCE((
    SELECT jsonb_agg(method ORDER BY method)
    FROM (
      SELECT DISTINCT t.payment_method AS method
      FROM public.transaction t
      WHERE t.org_id = p_org_id
        AND t.deleted_at IS NULL
        AND t.payment_method IS NOT NULL
    ) p
  ), '[]'::jsonb),
  'has_any', EXISTS (
    SELECT 1 FROM public.transaction t
    WHERE t.org_id = p_org_id AND t.deleted_at IS NULL
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.get_org_history_filter_options(uuid) TO authenticated;
