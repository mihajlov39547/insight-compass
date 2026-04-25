-- Seed / reseed the current What's New articles.
-- Run this from the Supabase SQL editor or another admin SQL session.
-- published_at values are recalculated relative to the time this script runs.

WITH seed_articles AS (
  SELECT *
  FROM (
    VALUES
      (
        'smart-document-summarization',
        'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=120&h=80&fit=crop',
        interval '3 days',
        'Smart Document Summarization',
        'Automatically generate concise summaries from uploaded documents using advanced AI. Save time by extracting key insights without reading entire files.',
        'Pametno sazetanje dokumenata',
        'Automatski kreirajte kratke sazetke iz otpremljenih dokumenata pomocu napredne vestacke inteligencije. Ustedite vreme izdvajanjem kljucnih uvida bez citanja celih fajlova.'
      ),
      (
        'multi-language-chat-support',
        'https://images.unsplash.com/photo-1518770660439-4636190af475?w=120&h=80&fit=crop',
        interval '1 week',
        'Multi-language Chat Support',
        'Chat with your knowledge base in multiple languages. Our assistant now supports seamless switching between English and Serbian with improved accuracy.',
        'Visejezicka podrska za caskanje',
        'Razgovarajte sa bazom znanja na vise jezika. Asistent sada podrzava lako prebacivanje izmedju engleskog i srpskog uz bolju preciznost.'
      ),
      (
        'collaborative-workspaces',
        'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=120&h=80&fit=crop',
        interval '2 weeks',
        'Collaborative Workspaces',
        'Share projects with team members and collaborate in real-time. New permission controls let you manage who can view, edit, or manage your knowledge bases.',
        'Zajednicki radni prostori',
        'Delite projekte sa clanovima tima i saradjujte u realnom vremenu. Nove kontrole dozvola omogucavaju upravljanje time ko moze da pregleda, uredjuje ili administrira vase baze znanja.'
      ),
      (
        'web-search',
        'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=120&h=80&fit=crop',
        interval '4 days',
        'Web Search',
        'Ground answers in fresh information from across the web. Toggle Web Search in the chat input to let the assistant fetch live results, cite sources inline, and blend them with your project documents for up-to-date, verifiable responses.',
        'Pretraga veba',
        'Utemeljite odgovore u svezim informacijama sa veba. Ukljucite Web Search u unosu poruke kako bi asistent dohvatio aktuelne rezultate, citirao izvore i povezao ih sa dokumentima projekta.'
      ),
      (
        'deep-research',
        'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=120&h=80&fit=crop',
        interval '5 days',
        'Deep Research',
        'Tackle complex questions with the new Research mode. The assistant plans a multi-step investigation, runs parallel web searches, follows up on the strongest leads, and returns a structured synthesis with a transparent trace of every source consulted.',
        'Dubinsko istrazivanje',
        'Resavajte slozena pitanja pomocu novog Research rezima. Asistent planira istrazivanje kroz vise koraka, pokrece paralelne pretrage, prati najbolje tragove i vraca strukturisanu sintezu sa pregledom koriscenih izvora.'
      ),
      (
        'youtube-search',
        'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=120&h=80&fit=crop',
        interval '6 days',
        'YouTube Search',
        'Bring video knowledge into your chats. Search YouTube directly from the assistant, preview matching videos, and link them as sources. Transcripts are fetched and indexed automatically so you can ask questions grounded in the spoken content.',
        'YouTube pretraga',
        'Uvedite znanje iz videa u caskanja. Pretrazujte YouTube direktno iz asistenta, pregledajte pronadjene video snimke i povezite ih kao izvore. Transkripti se automatski preuzimaju i indeksiraju.'
      ),
      (
        'notebooks-as-context',
        'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=120&h=80&fit=crop',
        interval '1 week',
        'Notebooks as Context',
        'Reference an entire notebook in any prompt. Pick a notebook from the chat input and the assistant will use its sources, notes, and extracted text as grounded context, perfect for reusing curated research across multiple conversations.',
        'Beleznice kao kontekst',
        'Pozovite celu beleznicu u bilo kom upitu. Izaberite beleznicu iz unosa poruke i asistent ce koristiti njene izvore, beleske i izdvojeni tekst kao utemeljen kontekst za vise razgovora.'
      )
  ) AS article(
    slug,
    image_url,
    publish_offset,
    en_title,
    en_description,
    sr_title,
    sr_description
  )
),
upserted_articles AS (
  INSERT INTO public.whats_new_articles (slug, image_url, published_at, is_published)
  SELECT slug, image_url, now() - publish_offset, true
  FROM seed_articles
  ON CONFLICT (slug) DO UPDATE
  SET image_url = EXCLUDED.image_url,
      published_at = EXCLUDED.published_at,
      is_published = EXCLUDED.is_published
  RETURNING id, slug
),
localized_rows AS (
  SELECT a.id AS article_id, 'en' AS locale, s.en_title AS title, s.en_description AS description
  FROM upserted_articles a
  JOIN seed_articles s ON s.slug = a.slug
  UNION ALL
  SELECT a.id AS article_id, 'sr' AS locale, s.sr_title AS title, s.sr_description AS description
  FROM upserted_articles a
  JOIN seed_articles s ON s.slug = a.slug
)
INSERT INTO public.whats_new_article_localizations (article_id, locale, title, description)
SELECT article_id, locale, title, description
FROM localized_rows
ON CONFLICT (article_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    description = EXCLUDED.description;

-- Template for publishing a new localized article later:
--
-- WITH article AS (
--   INSERT INTO public.whats_new_articles (slug, image_url, published_at, is_published)
--   VALUES ('new-feature-slug', 'https://example.com/image.jpg', now(), true)
--   RETURNING id
-- )
-- INSERT INTO public.whats_new_article_localizations (article_id, locale, title, description)
-- SELECT id, 'en', 'English title', 'English description' FROM article
-- UNION ALL
-- SELECT id, 'sr', 'Srpski naslov', 'Srpski opis' FROM article;
