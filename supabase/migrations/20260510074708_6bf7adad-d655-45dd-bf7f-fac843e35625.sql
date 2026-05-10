CREATE OR REPLACE FUNCTION public.extract_youtube_video_id(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_url text;
  v_match text;
BEGIN
  IF p_url IS NULL THEN
    RETURN NULL;
  END IF;
  v_url := btrim(p_url);
  IF v_url = '' THEN
    RETURN NULL;
  END IF;

  -- youtu.be/<id>
  v_match := substring(v_url from 'youtu\.be/([A-Za-z0-9_-]{6,})');
  IF v_match IS NOT NULL THEN RETURN v_match; END IF;

  -- youtube.com/watch?v=<id>
  v_match := substring(v_url from '[?&]v=([A-Za-z0-9_-]{6,})');
  IF v_match IS NOT NULL THEN RETURN v_match; END IF;

  -- youtube.com/embed/<id> or /shorts/<id> or /v/<id> or /live/<id>
  v_match := substring(v_url from 'youtube\.com/(?:embed|shorts|v|live)/([A-Za-z0-9_-]{6,})');
  IF v_match IS NOT NULL THEN RETURN v_match; END IF;

  RETURN NULL;
END;
$$;