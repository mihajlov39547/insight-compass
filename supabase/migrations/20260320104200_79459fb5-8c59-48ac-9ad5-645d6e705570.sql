-- Update username generation to use the first 5 letters from the email local-part plus a unique 2-digit suffix.
-- Also ensure signup triggers are attached and backfill missing/legacy usernames.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  email_local text;
  base_username text;
  suffix_num integer;
  candidate text;
  username_exists boolean;
BEGIN
  email_local := lower(split_part(COALESCE(NEW.email, ''), '@', 1));
  email_local := regexp_replace(email_local, '[^a-z]', '', 'g');
  base_username := left(email_local, 5);

  IF length(base_username) < 5 THEN
    base_username := rpad(base_username, 5, 'x');
  END IF;

  LOOP
    suffix_num := floor(random() * 100)::int;
    candidate := base_username || lpad(suffix_num::text, 2, '0');
    SELECT EXISTS(
      SELECT 1
      FROM public.profiles
      WHERE username = candidate
    ) INTO username_exists;
    EXIT WHEN NOT username_exists;
  END LOOP;

  INSERT INTO public.profiles (user_id, full_name, email, avatar_url, username)
  VALUES (
    NEW.id,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''), ''),
    NEW.email,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture', ''), ''),
    candidate
  )
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
      email = COALESCE(public.profiles.email, EXCLUDED.email),
      avatar_url = COALESCE(NULLIF(public.profiles.avatar_url, ''), EXCLUDED.avatar_url),
      username = COALESCE(NULLIF(public.profiles.username, ''), EXCLUDED.username);

  RETURN NEW;
END;
$$;

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

DO $$
DECLARE
  rec RECORD;
  email_local text;
  base_username text;
  suffix_num integer;
  candidate text;
  username_exists boolean;
BEGIN
  FOR rec IN
    SELECT id, email
    FROM public.profiles
    WHERE username IS NULL
       OR username = ''
       OR username !~ '^[a-z]{5}[0-9]{2}$'
  LOOP
    email_local := lower(split_part(COALESCE(rec.email, ''), '@', 1));
    email_local := regexp_replace(email_local, '[^a-z]', '', 'g');
    base_username := left(email_local, 5);

    IF length(base_username) < 5 THEN
      base_username := rpad(base_username, 5, 'x');
    END IF;

    LOOP
      suffix_num := floor(random() * 100)::int;
      candidate := base_username || lpad(suffix_num::text, 2, '0');
      SELECT EXISTS(
        SELECT 1
        FROM public.profiles
        WHERE username = candidate
          AND id <> rec.id
      ) INTO username_exists;
      EXIT WHEN NOT username_exists;
    END LOOP;

    UPDATE public.profiles
    SET username = candidate
    WHERE id = rec.id;
  END LOOP;
END;
$$;