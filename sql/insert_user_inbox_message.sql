-- Backfill welcome inbox messages for currently registered users.
-- Safe to run multiple times: source_type + source_id prevents duplicates.

WITH existing_users AS (
  SELECT *
  FROM (
    VALUES
      (
        'dd57ab27-46c5-4c2c-b8c1-c1c6994c9bc9'::uuid,
        'aktika.pr@gmail.com',
        'PR Aktika'
      ),
      (
        '7c0f599f-e173-46c0-9020-1a57af5f45ca'::uuid,
        'djmarx@gmail.com',
        'Marko Mihajlović'
      ),
      (
        'd9166e7b-d7df-40cc-817a-8e7485c16b9d'::uuid,
        'marko.mihajlovic.23@singimail.rs',
        'marko.mihajlovic.23'
      )
  ) AS user_row(user_id, email, display_name)
)
INSERT INTO public.user_inbox_messages (
  user_id,
  kind,
  title,
  body,
  action_label,
  action_url,
  metadata,
  source_type,
  source_id
)
SELECT
  user_id,
  'system',
  'Welcome to Researcher',
  'Your knowledge workspace is ready. Create a project, upload documents, and start asking questions grounded in your own sources.',
  'Start exploring',
  '/',
  jsonb_build_object(
    'event', 'user_registered_backfill',
    'email', email,
    'displayName', display_name
  ),
  'welcome_user',
  user_id
FROM existing_users
ON CONFLICT (source_type, source_id)
WHERE source_type IS NOT NULL AND source_id IS NOT NULL
DO NOTHING;

-- Template for sending a custom user inbox message later:
--
-- INSERT INTO public.user_inbox_messages (
--   user_id,
--   kind,
--   title,
--   body,
--   action_label,
--   action_url,
--   metadata
-- )
-- VALUES (
--   '00000000-0000-0000-0000-000000000000',
--   'admin',
--   'Message title',
--   'Message body shown in the user inbox.',
--   'Open',
--   '/profile-settings',
--   jsonb_build_object('sentBy', 'admin')
-- );
