ALTER TABLE public.plant_case_images
  ADD COLUMN IF NOT EXISTS drive_thumbnail_link text,
  ADD COLUMN IF NOT EXISTS drive_thumbnail_version text,
  ADD COLUMN IF NOT EXISTS drive_has_thumbnail boolean,
  ADD COLUMN IF NOT EXISTS drive_image_width int,
  ADD COLUMN IF NOT EXISTS drive_image_height int,
  ADD COLUMN IF NOT EXISTS drive_web_content_link text;