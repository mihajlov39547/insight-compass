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
  rawProviderResponse?: Record<string, unknown>;
}
