export type WebSearchProvider = 'tavily' | 'google';

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  favicon?: string;
}

export interface WebSearchResponse {
  provider: WebSearchProvider;
  query: string;
  results: WebSearchResult[];
  responseTime?: number;
  requestId?: string;
  /** Tavily's advanced answer string when include_answer is enabled. */
  answer?: string | null;
  rawProviderResponse?: Record<string, unknown>;
}
