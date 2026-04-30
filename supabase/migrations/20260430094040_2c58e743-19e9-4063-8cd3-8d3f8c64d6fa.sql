-- Enforce plan-based sharing limits at the database level so the rules
-- cannot be bypassed by direct API calls.

CREATE OR REPLACE FUNCTION public.enforce_share_plan_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_member_count integer;
  v_basic_max constant integer := 3;
BEGIN
  -- Look up the sharer's plan. Default to 'free' if missing.
  SELECT lower(coalesce(p.plan, 'free'))
  INTO v_plan
  FROM public.profiles p
  WHERE p.user_id = NEW.shared_by_user_id
  LIMIT 1;

  IF v_plan IS NULL THEN
    v_plan := 'free';
  END IF;

  -- Free plan: no sharing at all.
  IF v_plan = 'free' THEN
    RAISE EXCEPTION 'Sharing is not available on the Free plan. Please upgrade to share projects or notebooks.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Basic plan: projects only, up to 3 members per project.
  IF v_plan = 'basic' THEN
    IF NEW.item_type = 'notebook' THEN
      RAISE EXCEPTION 'Notebook sharing is only available on the Premium plan. Please upgrade to share notebooks.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.item_type = 'project' THEN
      SELECT COUNT(*)
      INTO v_member_count
      FROM public.shares s
      WHERE s.item_id = NEW.item_id
        AND s.item_type = 'project'
        AND (TG_OP = 'INSERT' OR s.id <> NEW.id);

      IF v_member_count >= v_basic_max THEN
        RAISE EXCEPTION 'Basic plan allows up to % members per project. Upgrade to Premium for unlimited sharing.', v_basic_max
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- premium / enterprise: no plan-based restriction here.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_share_plan_limits ON public.shares;
CREATE TRIGGER trg_enforce_share_plan_limits
BEFORE INSERT ON public.shares
FOR EACH ROW
EXECUTE FUNCTION public.enforce_share_plan_limits();
