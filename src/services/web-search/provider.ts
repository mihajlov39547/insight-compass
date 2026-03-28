import type { WebSearchResponse } from './types';

export interface IWebSearchService {
  search(query: string): Promise<WebSearchResponse>;
}
