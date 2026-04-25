-- Database-backed What's New articles.
-- Articles are managed by admins through SQL and are read-only for app users.

CREATE TABLE IF NOT EXISTS public.whats_new_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  image_url TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whats_new_article_localizations (
  article_id UUID NOT NULL REFERENCES public.whats_new_articles(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, locale),
  CONSTRAINT whats_new_article_localizations_locale_check
    CHECK (locale ~ '^[a-z]{2}(-[A-Za-z0-9]+)*$')
);

CREATE INDEX IF NOT EXISTS idx_whats_new_articles_published
  ON public.whats_new_articles (published_at DESC)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS idx_whats_new_article_localizations_locale
  ON public.whats_new_article_localizations (locale);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_whats_new_articles_updated_at ON public.whats_new_articles;
CREATE TRIGGER set_whats_new_articles_updated_at
  BEFORE UPDATE ON public.whats_new_articles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_whats_new_article_localizations_updated_at ON public.whats_new_article_localizations;
CREATE TRIGGER set_whats_new_article_localizations_updated_at
  BEFORE UPDATE ON public.whats_new_article_localizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whats_new_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whats_new_article_localizations ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.whats_new_articles TO anon, authenticated;
GRANT SELECT ON public.whats_new_article_localizations TO anon, authenticated;

DO $$ BEGIN
  CREATE POLICY "Published what's new articles are readable"
    ON public.whats_new_articles FOR SELECT
    USING (is_published = true AND published_at <= now());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Published what's new localizations are readable"
    ON public.whats_new_article_localizations FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.whats_new_articles article
        WHERE article.id = whats_new_article_localizations.article_id
          AND article.is_published = true
          AND article.published_at <= now()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
