
-- Attach triggers to auth.users (they were created as functions but never attached)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_created_settings ON auth.users;
CREATE TRIGGER on_auth_user_created_settings
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_settings();

-- Backfill: generate username for existing profiles that don't have one
DO $$
DECLARE
  rec RECORD;
  new_username text;
  username_exists boolean;
BEGIN
  FOR rec IN SELECT id FROM public.profiles WHERE username IS NULL OR username = '' LOOP
    LOOP
      new_username := '';
      FOR i IN 1..7 LOOP
        new_username := new_username || chr(97 + floor(random() * 26)::int);
      END LOOP;
      SELECT EXISTS(SELECT 1 FROM public.profiles WHERE username = new_username) INTO username_exists;
      EXIT WHEN NOT username_exists;
    END LOOP;
    UPDATE public.profiles SET username = new_username WHERE id = rec.id;
  END LOOP;
END $$;
