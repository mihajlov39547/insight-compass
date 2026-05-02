-- Remove the cron job
SELECT cron.unschedule('youtube-transcript-worker-minute');

-- Drop the legacy queue table
DROP TABLE IF EXISTS public.youtube_transcript_jobs;

-- Drop the unused helper function
DROP FUNCTION IF EXISTS public.extract_youtube_video_id(text);