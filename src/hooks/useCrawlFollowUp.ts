import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { toast } from 'sonner';
import {
  runTavilyCrawl,
  formatCrawlMarkdown,
  type CrawlResponse,
  type CrawlExtractDepth,
  type CrawlPageItem,
} from '@/services/tavily-crawl';

export type CrawlScope =
  | { kind: 'chat'; chatId: string }
  | { kind: 'notebook'; notebookId: string };

export interface CrawlSelection {
  url: string;
  title?: string | null;
  favicon?: string | null;
}

interface UseCrawlFollowUpResult {
  isCrawling: boolean;
  crawlingMessageId: string | null;
  runCrawl: (
    scope: CrawlScope,
    sourceMessageId: string,
    selection: CrawlSelection,
    instructions: string | null,
    depth?: CrawlExtractDepth,
  ) => Promise<void>;
}

interface PersistedCrawlSourcesPayload {
  augmentationMode: 'crawl';
  items: Array<{
    id: string;
    type: 'web';
    title: string;
    url: string;
    favicon: string | null;
    snippet: string;
    relevance: number;
  }>;
  crawl: {
    rootUrl: string;
    baseUrl: string;
    instructions: string | null;
    extractDepth: CrawlExtractDepth;
    maxDepth: number;
    maxBreadth: number;
    limit: number;
    pageCount: number;
    results: CrawlPageItem[];
    response_time: number | null;
    request_id: string | null;
    synthesizedAnswer: string | null;
    synthesisError: string | null;
    synthesisModel: string | null;
    sourceMessageId: string;
  };
}

function buildPersistedSources(
  selection: CrawlSelection,
  result: CrawlResponse,
  sourceMessageId: string,
): PersistedCrawlSourcesPayload {
  const items: PersistedCrawlSourcesPayload['items'] = [];

  // Always include the root selection first.
  items.push({
    id: 'crawl-root',
    type: 'web',
    title: selection.title || result.base_url,
    url: result.url,
    favicon: selection.favicon ?? null,
    snippet: result.synthesizedAnswer
      ? result.synthesizedAnswer.slice(0, 240)
      : result.results[0]?.raw_content?.slice(0, 240) || '',
    relevance: 1,
  });

  // Surface up to top 8 crawled pages in the Sources box (skip root duplicate).
  const seen = new Set<string>([result.url]);
  let added = 0;
  for (let i = 0; i < result.results.length && added < 8; i++) {
    const r = result.results[i];
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    items.push({
      id: `crawl-page-${i}`,
      type: 'web',
      title: r.title || r.url,
      url: r.url,
      favicon: r.favicon ?? selection.favicon ?? null,
      snippet: (r.raw_content || '').slice(0, 200),
      relevance: 0.9 - i * 0.05,
    });
    added++;
  }

  return {
    augmentationMode: 'crawl',
    items,
    crawl: {
      rootUrl: result.url,
      baseUrl: result.base_url,
      instructions: result.instructions,
      extractDepth: result.extract_depth,
      maxDepth: result.max_depth,
      maxBreadth: result.max_breadth,
      limit: result.limit,
      pageCount: result.page_count,
      results: result.results,
      response_time: result.response_time,
      request_id: result.request_id,
      synthesizedAnswer: result.synthesizedAnswer,
      synthesisError: result.synthesisError,
      synthesisModel: result.synthesisModel,
      sourceMessageId,
    },
  };
}

export function useCrawlFollowUp(): UseCrawlFollowUpResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [crawlingMessageId, setCrawlingMessageId] = useState<string | null>(null);

  const runCrawl = useCallback(
    async (
      scope: CrawlScope,
      sourceMessageId: string,
      selection: CrawlSelection,
      instructions: string | null,
      depth: CrawlExtractDepth = 'basic',
    ) => {
      if (!user) {
        toast.error('You must be signed in to crawl a source');
        return;
      }
      if (!selection?.url) {
        toast.error('Select a source to crawl');
        return;
      }

      setCrawlingMessageId(sourceMessageId);
      try {
        const result = await runTavilyCrawl({
          url: selection.url,
          instructions,
          extract_depth: depth,
        });

        if (result.results.length === 0) {
          toast.error('Crawl returned no readable pages');
        }

        const content = formatCrawlMarkdown(result);
        const persistedSources = buildPersistedSources(selection, result, sourceMessageId);
        const depthTag = result.extract_depth === 'advanced' ? ':advanced' : ':basic';
        const modelId = `tavily-crawl${depthTag}${result.synthesisModel ? `:${result.synthesisModel}` : ''}`;

        if (scope.kind === 'chat') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: insertError } = await supabase.from('messages').insert({
            chat_id: scope.chatId,
            user_id: user.id,
            role: 'assistant',
            content,
            sources: persistedSources as any,
            model_id: modelId,
          });
          if (insertError) throw insertError;
          qc.invalidateQueries({ queryKey: ['messages', scope.chatId] });
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: insertError } = await (supabase.from('notebook_messages' as any) as any).insert({
            notebook_id: scope.notebookId,
            user_id: user.id,
            role: 'assistant',
            content,
            sources: persistedSources,
            model_id: modelId,
          });
          if (insertError) throw insertError;
          qc.invalidateQueries({ queryKey: ['notebook-messages', scope.notebookId] });
        }

        if (result.results.length > 0) {
          const depthLabel = result.extract_depth === 'advanced' ? ' (deep)' : '';
          toast.success(
            `Crawled ${result.results.length} page${result.results.length === 1 ? '' : 's'}${depthLabel}`,
          );
        }
      } catch (err: unknown) {
        console.error('tavily-crawl failed:', err);
        const msg = err instanceof Error ? err.message : 'Failed to crawl selected source';
        toast.error(msg);
      } finally {
        setCrawlingMessageId(null);
      }
    },
    [user, qc],
  );

  return {
    isCrawling: crawlingMessageId !== null,
    crawlingMessageId,
    runCrawl,
  };
}
