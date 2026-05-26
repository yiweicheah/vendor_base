-- Covering index for History pagination + get_org_metrics/breakdown/monthly_pl scans.
-- Keyset / offset pagination orders by (created_at DESC, id DESC); the partial
-- predicate keeps deleted rows out of the index entirely (every query already
-- filters `deleted_at IS NULL`).

CREATE INDEX IF NOT EXISTS transaction_org_created_id_idx
  ON public.transaction (org_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
