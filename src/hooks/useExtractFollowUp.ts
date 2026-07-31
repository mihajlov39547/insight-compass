import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { toast } from 'sonner';
import {
  runTavilyExtract,
  formatExtractMarkdown,
  type ExtractResponse,
  type ExtractSourceItem,
  type ExtractFailedItem,
  type ExtractDepth,
} from '@/services/tavily-extract';
import type { ExtractSelection } from '@/components/chat/SourceAttribution';
import { localizePlantCaseContent } from '@/services/plant-case-localize';

export type ExtractScope =
  | { kind: 'chat'; chatId: string }
  | { kind: 'notebook'; notebookId: string }
  // Plant Advisor: saves the extracted content into the plant case chat so it
  // stays linked to the user + case + source URL.
  | { kind: 'plant_case'; caseId: string; lang?: 'en' | 'sr' };


interface UseExtractFollowUpResult {
  isExtracting: boolean;
  extractingMessageId: string | null;
  runExtract: (
    scope: ExtractScope,
    sourceMessageId: string,
    selections: ExtractSelection[],
    question: string | null,
    depth?: ExtractDepth,
  ) => Promise<void>;
}

interface PersistedExtractSourcesPayload {
  augmentationMode: 'extract';
  items: Array<{
    id: string;
    type: 'web';
    title: string;
    url: string;
    favicon: string | null;
    snippet: string;
    relevance: number;
  }>;
  extract: {
    query: string | null;
    requestedUrls: string[];
    extractDepth: ExtractDepth;
    results: ExtractSourceItem[];
    failed_results: ExtractFailedItem[];
    response_time: number | null;
    request_id: string | null;
    synthesizedAnswer: string | null;
    synthesisError: string | null;
    synthesisModel: string | null;
    sourceMessageId: string;
  };
}

function buildPersistedSources(
  selections: ExtractSelection[],
  result: ExtractResponse,
  sourceMessageId: string,
): PersistedExtractSourcesPayload {
  const titleByUrl = new Map<string, ExtractSelection>();
  for (const s of selections) titleByUrl.set(s.url, s);

  // Surface every selected URL in the Sources box (including failed ones,
  // marked with empty snippet) so attribution stays consistent with prior UX.
  const seen = new Set<string>();
  const items: PersistedExtractSourcesPayload['items'] = [];

  for (let i = 0; i < result.results.length; i++) {
    const r = result.results[i];
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    const sel = titleByUrl.get(r.url);
    items.push({
      id: `extract-${i}`,
      type: 'web',
      title: r.title || sel?.title || r.url,
      url: r.url,
      favicon: r.favicon ?? sel?.favicon ?? null,
      snippet: (r.raw_content || '').slice(0, 240),
      relevance: 1,
    });
  }
  // Add failed selections too so they appear in the source list.
  for (let i = 0; i < selections.length; i++) {
    const s = selections[i];
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    items.push({
      id: `extract-failed-${i}`,
      type: 'web',
      title: s.title || s.url,
      url: s.url,
      favicon: s.favicon ?? null,
      snippet: '',
      relevance: 0,
    });
  }

  return {
    augmentationMode: 'extract',
    items,
    extract: {
      query: result.query,
      requestedUrls: result.urls,
      extractDepth: result.extract_depth,
      results: result.results,
      failed_results: result.failed_results,
      response_time: result.response_time,
      request_id: result.request_id,
      synthesizedAnswer: result.synthesizedAnswer,
      synthesisError: result.synthesisError,
      synthesisModel: result.synthesisModel,
      sourceMessageId,
    },
  };
}

export function useExtractFollowUp(): UseExtractFollowUpResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [extractingMessageId, setExtractingMessageId] = useState<string | null>(null);

  const runExtract = useCallback(
    async (
      scope: ExtractScope,
      sourceMessageId: string,
      selections: ExtractSelection[],
      question: string | null,
      depth: ExtractDepth = 'basic',
    ) => {
      if (!user) {
        toast.error('You must be signed in to extract sources');
        return;
      }
      if (selections.length === 0) {
        toast.error('Select at least one source to extract');
        return;
      }

      setExtractingMessageId(sourceMessageId);
      try {
        // Plant Advisor generated summaries follow the Plant Advisor
        // identification language, not the global UI language.
        const langSuffix =
          scope.kind === 'plant_case' && scope.lang === 'sr'
            ? ' (Odgovori na srpskom jeziku, latinicom.)'
            : scope.kind === 'plant_case'
              ? ' (Answer in English.)'
              : '';

        const result = await runTavilyExtract({
          urls: selections.map((s) => s.url),
          query: question ? `${question}${langSuffix}` : (langSuffix.trim() || null),
          extract_depth: depth,
        });

        if (result.results.length === 0 && result.failed_results.length === selections.length) {
          toast.error('Could not extract any of the selected sources');
        }

        const content = formatExtractMarkdown(result, selections);
        const persistedSources = buildPersistedSources(selections, result, sourceMessageId);
        const depthTag = result.extract_depth === 'advanced' ? ':advanced' : ':basic';
        const modelId = `tavily-extract${depthTag}${result.synthesisModel ? `:${result.synthesisModel}` : ''}`;

        if (scope.kind === 'chat') {
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
        } else if (scope.kind === 'notebook') {
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
        } else {
          // Tavily can return source text in the original language — run a
          // language-aware formatter so the saved answer matches the Plant
          // Advisor identification language. Raw data stays in metadata.
          const lang = scope.lang ?? 'en';
          const localized = await localizePlantCaseContent({
            content,
            lang,
            question,
            mode: 'extract',
          });

          const { error: insertError } = await supabase.from('plant_case_chat_messages').insert({
            case_id: scope.caseId,
            user_id: user.id,
            role: 'assistant',
            content: localized.content ?? content,
            metadata: {
              kind: 'extract',
              model: modelId,
              lang: scope.lang ?? 'en',
              sourceMessageId,
              sourcesUsed: persistedSources.items.map((it) => ({
                id: it.id,
                provider: 'web',
                title: it.title,
                url: it.url,
                domain: (() => { try { return new URL(it.url).hostname.replace(/^www\./, ''); } catch { return null; } })(),
                score: it.relevance,
                sourceType: 'extracted',
                authorityScore: null,
                cardKey: null,
                snippet: it.snippet,
              })),
              extract: persistedSources.extract,
            } as any,
          });
          if (insertError) throw insertError;
          qc.invalidateQueries({ queryKey: ['plant-case-chat-messages', scope.caseId] });
        }


        if (result.results.length > 0) {
          const depthLabel = result.extract_depth === 'advanced' ? ' (deep)' : '';
          toast.success(
            result.failed_results.length > 0
              ? `Extracted ${result.results.length} of ${selections.length} sources${depthLabel}`
              : `Extracted ${result.results.length} source${result.results.length === 1 ? '' : 's'}${depthLabel}`,
          );
        }
      } catch (err: any) {
        console.error('tavily-extract failed:', err);
        toast.error(err?.message || 'Failed to extract selected sources');
      } finally {
        setExtractingMessageId(null);
      }
    },
    [user, qc],
  );

  return {
    isExtracting: extractingMessageId !== null,
    extractingMessageId,
    runExtract,
  };
}
