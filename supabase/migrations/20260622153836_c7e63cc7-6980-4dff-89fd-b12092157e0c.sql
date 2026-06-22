
-- Hardening pass: validate message_id on chat_message_pins inserts.
-- Ensures users cannot pin arbitrary UUIDs; the message must exist in the
-- correct messages table and belong to the project/notebook in the pin row.

ALTER TABLE public.chat_message_pins
  DROP CONSTRAINT IF EXISTS chat_message_pins_one_container_chk;

ALTER TABLE public.chat_message_pins
  ADD CONSTRAINT chat_message_pins_one_container_chk
  CHECK (
    (project_id IS NOT NULL AND notebook_id IS NULL)
    OR (project_id IS NULL AND notebook_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.validate_chat_message_pin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg_project_id uuid;
  v_msg_chat_id uuid;
  v_msg_role text;
  v_msg_notebook_id uuid;
  v_msg_user_id uuid;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT m.role, c.project_id, m.chat_id, m.user_id
      INTO v_msg_role, v_msg_project_id, v_msg_chat_id, v_msg_user_id
    FROM public.messages m
    JOIN public.chats c ON c.id = m.chat_id
    WHERE m.id = NEW.message_id;

    IF v_msg_project_id IS NULL THEN
      RAISE EXCEPTION 'pin target message not found' USING ERRCODE = '22023';
    END IF;
    IF v_msg_project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'pin project_id does not match message' USING ERRCODE = '22023';
    END IF;
    IF NEW.chat_id IS NOT NULL AND NEW.chat_id <> v_msg_chat_id THEN
      RAISE EXCEPTION 'pin chat_id does not match message' USING ERRCODE = '22023';
    END IF;
    IF NEW.chat_id IS NULL THEN
      NEW.chat_id := v_msg_chat_id;
    END IF;
    IF NEW.message_role <> v_msg_role THEN
      NEW.message_role := v_msg_role;
    END IF;
    IF NOT (
      v_msg_user_id = NEW.user_id
      OR public.check_item_permission(NEW.user_id, NEW.project_id, 'project', 'viewer')
    ) THEN
      RAISE EXCEPTION 'no viewer permission on project' USING ERRCODE = '42501';
    END IF;

  ELSIF NEW.notebook_id IS NOT NULL THEN
    SELECT nm.role, nm.notebook_id, nm.user_id
      INTO v_msg_role, v_msg_notebook_id, v_msg_user_id
    FROM public.notebook_messages nm
    WHERE nm.id = NEW.message_id;

    IF v_msg_notebook_id IS NULL THEN
      RAISE EXCEPTION 'pin target message not found' USING ERRCODE = '22023';
    END IF;
    IF v_msg_notebook_id <> NEW.notebook_id THEN
      RAISE EXCEPTION 'pin notebook_id does not match message' USING ERRCODE = '22023';
    END IF;
    IF NEW.message_role <> v_msg_role THEN
      NEW.message_role := v_msg_role;
    END IF;
    IF NOT (
      v_msg_user_id = NEW.user_id
      OR public.check_item_permission(NEW.user_id, NEW.notebook_id, 'notebook', 'viewer')
    ) THEN
      RAISE EXCEPTION 'no viewer permission on notebook' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'pin requires project_id or notebook_id' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_chat_message_pin ON public.chat_message_pins;
CREATE TRIGGER trg_validate_chat_message_pin
BEFORE INSERT OR UPDATE OF message_id, project_id, notebook_id, chat_id
ON public.chat_message_pins
FOR EACH ROW EXECUTE FUNCTION public.validate_chat_message_pin();
