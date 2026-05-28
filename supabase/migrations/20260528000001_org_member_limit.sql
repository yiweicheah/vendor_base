-- Add nullable member_limit. Adding without DEFAULT first so existing rows stay
-- NULL (= unlimited backfill). Then set DEFAULT 5 for newly created orgs.
ALTER TABLE public.organization
  ADD COLUMN member_limit integer;

ALTER TABLE public.organization
  ALTER COLUMN member_limit SET DEFAULT 5;

ALTER TABLE public.organization
  ADD CONSTRAINT org_member_limit_positive
  CHECK (member_limit IS NULL OR member_limit > 0);

-- Trigger: refuse to insert a new invite when
--   (active members) + (pending unexpired invites) >= member_limit.
-- NULL limit = unlimited. We only enforce on invite INSERT — accept-invite
-- swaps a pending invite for a member (net zero), and the only direct
-- addOrgMember call paths are superuser/owner-bootstrap which we let through.
CREATE OR REPLACE FUNCTION public.enforce_org_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_limit integer;
  v_used  integer;
BEGIN
  SELECT member_limit INTO v_limit
  FROM public.organization
  WHERE id = NEW.org_id;

  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    (SELECT count(*) FROM public.organization_members
       WHERE org_id = NEW.org_id)
    +
    (SELECT count(*) FROM public.invite
       WHERE org_id = NEW.org_id
         AND accepted_at IS NULL
         AND expires_at > now())
  INTO v_used;

  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'Org member limit reached (% / %)', v_used, v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_org_member_limit_on_invite
BEFORE INSERT ON public.invite
FOR EACH ROW
EXECUTE FUNCTION public.enforce_org_member_limit();
