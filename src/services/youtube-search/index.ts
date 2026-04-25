// Frontend client for the serpapi-youtube-search edge function.
// Returns the synthesized assistant answer + the 5 normalized video sources.

import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';

const YOUTUBE_SEARCH_URL = getFunctionUrl('/functions/v1/serpapi-youtube-search');

export interface YouTubeSearchSource {
  id: string;
  type: 'youtube';
  title: string;
  url: string;
  videoId: string;
  channelName?: string;
  channelUrl?: string;
  publishedDate?: string;
  views?: number | string;
  length?: string;
  description?: string;
  thumbnail?: string | null;
}

export interface YouTubeSearchResponse {
  provider: 'serpapi';
  augmentationMode: 'youtube_search';
  query: string;
  sources: YouTubeSearchSource[];
  result_count: number;
  synthesizedAnswer: string;
  synthesisError: string | null;
  synthesisModel: string | null;
}

export async function runYouTubeSearch(
  query: string,
  responseLanguage?: string,
  signal?: AbortSignal
): Promise<YouTubeSearchResponse> {
  const resp = await fetch(YOUTUBE_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ query, responseLanguage }),
    signal,
  });

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({ error: 'YouTube search failed' }));
    throw new Error(errBody.error || `YouTube search failed (${resp.status})`);
  }

  const data = await resp.json();
  return data as YouTubeSearchResponse;
}

/**
 * Convert YouTube sources into the unified SourceItem shape used by
 * SourceAttribution. They keep type='youtube' so the UI can render the
 * compact YouTube card.
 */
export function youtubeSourcesToUnified(sources: YouTubeSearchSource[]) {
  return sources.map((s, idx) => ({
    id: s.id || `youtube-${idx}`,
    type: 'youtube' as const,
    title: s.title,
    snippet: s.description ?? '',
    relevance: 1 - idx / Math.max(sources.length, 1),
    url: s.url,
    favicon: null,
    videoId: s.videoId,
    channelName: s.channelName,
    channelUrl: s.channelUrl,
    publishedDate: s.publishedDate,
    views: s.views,
    length: s.length,
    thumbnail: s.thumbnail ?? null,
  }));
}
