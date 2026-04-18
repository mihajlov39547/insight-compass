import type { IWebSearchService } from './provider';
import { TavilyWebSearchService } from './tavilyWebSearchService';
import type { WebSearchProvider } from './types';

export function getWebSearchService(provider: WebSearchProvider): IWebSearchService {
  if (provider === 'tavily') {
    return new TavilyWebSearchService();
  }

  throw new Error(`Unsupported web search provider: ${provider}`);
}

export async function searchWeb(query: string) {
  const service = getWebSearchService('tavily');
  return service.search(query);
}

export type { WebSearchProvider, WebSearchResponse, WebSearchResult } from './types';
export type { IWebSearchService } from './provider';
export { persistWebSearchResponse } from './persistWebSearch';
export type { PersistWebSearchParams, PersistedWebSearch } from './persistWebSearch';
export {
  WebSearchTraceBuilder,
  toWebSearchSourcePreviews,
} from './webSearchTrace';
export type {
  WebSearchPhase,
  WebSearchTraceEvent,
  WebSearchTraceState,
  WebSearchSourcePreview,
} from './webSearchTrace';
