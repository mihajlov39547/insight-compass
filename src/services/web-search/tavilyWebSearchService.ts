import { supabase } from '@/integrations/supabase/client';
import type { IWebSearchService } from './provider';
import type { WebSearchResponse, WebSearchResult } from './types';

interface TavilyEdgeResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  favicon?: string | null;
}

interface TavilyEdgeResponse {
  provider?: string;
  query?: string;
  results?: TavilyEdgeResult[];
  responseTime?: number;
  requestId?: string | null;
}

export class TavilyWebSearchService implements IWebSearchService {
  async search(query: string): Promise<WebSearchResponse> {
    const { data, error } = await supabase.functions.invoke<TavilyEdgeResponse>('tavily-search', {
      body: { query },
    });

    if (error) {
      throw new Error(error.message || 'Web search failed');
    }

    const safeData = data ?? {};
    const safeResults = Array.isArray(safeData.results) ? safeData.results : [];

    const results: WebSearchResult[] = safeResults.map((item) => ({
      title: typeof item?.title === 'string' ? item.title : '',
      url: typeof item?.url === 'string' ? item.url : '',
      content: typeof item?.content === 'string' ? item.content : '',
      score: typeof item?.score === 'number' ? item.score : undefined,
      favicon: typeof item?.favicon === 'string' ? item.favicon : undefined,
    }));

    return {
      provider: 'tavily',
      query: typeof safeData.query === 'string' ? safeData.query : query,
      results,
      responseTime: typeof safeData.responseTime === 'number' ? safeData.responseTime : undefined,
      requestId: typeof safeData.requestId === 'string' ? safeData.requestId : undefined,
    };
  }
}
