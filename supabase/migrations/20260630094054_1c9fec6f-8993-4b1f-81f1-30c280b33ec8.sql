
ALTER TABLE public.plant_case_images
  ADD COLUMN IF NOT EXISTS storage_mode text NOT NULL DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS drive_file_id text,
  ADD COLUMN IF NOT EXISTS drive_web_view_link text,
  ADD COLUMN IF NOT EXISTS drive_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_mime_type text,
  ADD COLUMN IF NOT EXISTS drive_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS staging_storage_path text,
  ADD COLUMN IF NOT EXISTS upload_error_code text,
  ADD COLUMN IF NOT EXISTS upload_error_message text;

DO $$ BEGIN
  ALTER TABLE public.plant_case_images
    ADD CONSTRAINT plant_case_images_storage_mode_chk
    CHECK (storage_mode IN ('supabase','google_drive','hybrid'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.plant_case_images
    ADD CONSTRAINT plant_case_images_upload_status_chk
    CHECK (upload_status IN ('staged','uploading','ready','drive_failed','deleting','deleted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS plant_case_images_user_status_idx
  ON public.plant_case_images (user_id, upload_status);
