import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_LANGUAGE, normalizeLanguageCode } from '@/lib/languages';

export interface WhatsNewArticle {
  id: string;
  slug: string;
  title: string;
  description: string;
  imageUrl: string | null;
  publishedAt: string;
}

interface ArticleLocalizationRow {
  locale: string;
  title: string;
  description: string;
}

interface ArticleRow {
  id: string;
  slug: string;
  image_url: string | null;
  published_at: string;
  whats_new_article_localizations?: ArticleLocalizationRow[];
}

function pickLocalization(
  localizations: ArticleLocalizationRow[] | undefined,
  languageCode: string
) {
  return (
    localizations?.find(localization => localization.locale === languageCode) ??
    localizations?.find(localization => localization.locale === DEFAULT_LANGUAGE) ??
    localizations?.[0]
  );
}

export function useWhatsNewArticles(language?: string, enabled = true, limit = 7) {
  const languageCode = normalizeLanguageCode(language);

  return useQuery({
    queryKey: ['whats-new-articles', languageCode, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whats_new_articles' as any)
        .select(`
          id,
          slug,
          image_url,
          published_at,
          whats_new_article_localizations (
            locale,
            title,
            description
          )
        `)
        .eq('is_published', true)
        .lte('published_at', new Date().toISOString())
        .order('published_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return ((data ?? []) as unknown as ArticleRow[])
        .map(article => {
          const localization = pickLocalization(
            article.whats_new_article_localizations,
            languageCode
          );

          if (!localization) return null;

          return {
            id: article.id,
            slug: article.slug,
            title: localization.title,
            description: localization.description,
            imageUrl: article.image_url,
            publishedAt: article.published_at,
          } satisfies WhatsNewArticle;
        })
        .filter((article): article is WhatsNewArticle => article !== null);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
