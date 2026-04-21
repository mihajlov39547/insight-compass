import { useState, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { DEFAULT_MODEL_ID } from '@/config/modelOptions';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';
import { hybridRetrieve, toDocumentContext, toSources } from '@/hooks/useHybridRetrieval';
import { trimChatHistory } from '@/lib/chatHistoryConfig';
import { useUserSettings } from '@/hooks/useUserSettings';
import { getResponseLengthConfig, normalizeResponseLength } from '@/lib/ai/responseLength';
import type { ResponseLengthStrategy } from '@/lib/ai/responseLength';
import {
  runTavilyResearch,
  researchSourcesToUnified,
  type ResearchModel,
  type ResearchTraceState,
} from '@/services/research/tavilyResearch';
import { searchWeb, type WebSearchResponse, type WebSearchResult } from '@/services/web-search';
import { persistWebSearchResponse } from '@/services/web-search/persistWebSearch';
import {
  WebSearchTraceBuilder,
  type WebSearchTraceState,
} from '@/services/web-search/webSearchTrace';
import { runYouTubeSearch, youtubeSourcesToUnified } from '@/services/youtube-search';

const CHAT_URL = getFunctionUrl('/functions/v1/chat');
const SCOPE_CHECK_URL = getFunctionUrl('/functions/v1/notebook-scope-check');

export interface DbNotebookMessage {
  id: string;
  notebook_id: string;
  user_id: string;
  role: string;
  content: string;
  model_id: string | null;
  sources: any[] | null;
  created_at: string;
}

export function useNotebookMessages(notebookId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['notebook-messages', notebookId],
    queryFn: async () => {
      if (!notebookId) return [];
      const { data, error } = await (supabase.from('notebook_messages' as any) as any)
        .select('*')
        .eq('notebook_id', notebookId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DbNotebookMessage[];
    },
    enabled: !!user && !!notebookId,
  });
}

interface UseNotebookAIChatOptions {
  notebookId: string;
  notebookName?: string;
  notebookDescription?: string;
}

interface MessageOptions {
  useWebSearch: boolean;
  augmentationMode?: 'none' | 'web_search' | 'research' | 'youtube_search';
  researchModel?: ResearchModel;
}

interface NotebookSourceMetadata {
  items: any[];
  responseLength: ResponseLengthStrategy;
}

/** Retrieve notebook document context using hybrid retrieval (only enabled docs) */
async function retrieveNotebookDocContext(notebookId: string, userMessage: string) {
  try {
    const results = await hybridRetrieve({
      query: userMessage,
      scope: 'notebook',
      notebookId,
      maxResults: 8,
    });

    return {
      sources: toSources(results),
      contextForAI: toDocumentContext(results),
    };
  } catch {
    return { sources: [], contextForAI: [] };
  }
}

export function useNotebookAIChat({ notebookId, notebookName, notebookDescription }: UseNotebookAIChatOptions) {
  const { user } = useAuth();
  const { data: userSettings } = useUserSettings();
  const retrievalDepth = userSettings?.retrieval_depth ?? 'Medium';
  const responseLength = normalizeResponseLength(userSettings?.response_length);
  const responseLengthConfig = getResponseLengthConfig(responseLength);
  const qc = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [researchTrace, setResearchTrace] = useState<ResearchTraceState | null>(null);
  const [webSearchTrace, setWebSearchTrace] = useState<WebSearchTraceState | null>(null);

  const sendMessage = useCallback(async (content: string, modelId?: string, options?: MessageOptions) => {
    if (!user || !notebookId || isGenerating) return;
    const resolvedModel = modelId || DEFAULT_MODEL_ID;
    console.debug('[chat:length] client', {
      flow: 'notebook',
      responseLength,
      strategy: responseLengthConfig.strategy,
      maxOutputTokens: responseLengthConfig.maxOutputTokens,
    });
    setError(null);
    setIsGenerating(true);
    setStreamingContent('');
    setResearchTrace(null);
    setWebSearchTrace(null);

    try {
      // 1. Persist user message
      const { data: insertedUserMessage } = await (supabase.from('notebook_messages' as any) as any)
        .insert({
          notebook_id: notebookId,
          user_id: user.id,
          role: 'user',
          content,
          model_id: resolvedModel,
          sources: [],
        })
        .select('id')
        .single();
      qc.invalidateQueries({ queryKey: ['notebook-messages', notebookId] });

      // 1b. RESEARCH MODE — bypass scope check + RAG. Tavily Research is an explicit external action.
      if (options?.augmentationMode === 'research') {
        const researchResult = await runTavilyResearch({
          input: content,
          model: options.researchModel ?? 'auto',
          onEvent: (evt) => {
            if (evt.type === 'content_delta') {
              setStreamingContent((prev) => (prev ?? '') + evt.text);
            }
          },
          onTrace: (state) => setResearchTrace(state),
        });

        if (researchResult.errored && !researchResult.finalText) {
          throw new Error(researchResult.errorMessage || 'Research failed');
        }

        const webSources = researchSourcesToUnified(researchResult.sources);

        await (supabase.from('notebook_messages' as any) as any).insert({
          notebook_id: notebookId,
          user_id: user.id,
          role: 'assistant',
          content: researchResult.finalText,
          model_id: `tavily-research:${options.researchModel ?? 'auto'}`,
          sources: {
            items: webSources,
            responseLength,
            augmentationMode: 'research',
            researchProvider: 'tavily',
            researchModel: options.researchModel ?? 'auto',
            researchTrace: researchResult.trace,
          } as any,
        });

        qc.invalidateQueries({ queryKey: ['notebook-messages', notebookId] });
        return;
      }

      // 2. Run notebook scope check (Stage 1 — fast classification)
      let scopeAlignment = 'aligned';
      let scopeReason = '';
      try {
        // Gather short source summaries if available
        const { data: nbDocsForScope } = await (supabase.from('documents') as any)
          .select('file_name, summary')
          .eq('notebook_id', notebookId)
          .eq('notebook_enabled', true)
          .limit(10);
        const sourceSummaries = (nbDocsForScope || [])
          .map((d: any) => d.file_name + (d.summary ? `: ${d.summary.slice(0, 80)}` : ''))
          .filter(Boolean);

        const scopeResp = await fetch(SCOPE_CHECK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            notebookTitle: notebookName || '',
            notebookDescription: notebookDescription || '',
            sourceSummaries,
            userQuestion: content,
          }),
        });
        if (scopeResp.ok) {
          const scopeData = await scopeResp.json();
          scopeAlignment = scopeData.alignment || 'aligned';
          scopeReason = scopeData.reason || '';
        }
      } catch (err) {
        console.error('Scope check failed, defaulting to aligned:', err);
      }

      // If not aligned, return a notebook-scoped refusal
      if (scopeAlignment === 'not_aligned') {
        const topicHint = notebookName || notebookDescription || 'this notebook\'s topic';
        const refusalContent = `I can only answer questions grounded in this notebook's topic and sources. This notebook is about **${topicHint}**, so please ask a related question.${scopeReason ? `\n\n_Reason: ${scopeReason}_` : ''}`;

        await (supabase.from('notebook_messages' as any) as any).insert({
          notebook_id: notebookId,
          user_id: user.id,
          role: 'assistant',
          content: refusalContent,
          model_id: resolvedModel,
          sources: {
            items: [],
            responseLength,
          } as NotebookSourceMetadata,
        });
        qc.invalidateQueries({ queryKey: ['notebook-messages', notebookId] });
        return;
      }

      // 3. Retrieve notebook doc context (Stage 2) + optional web search (parallel).
      const wsTraceBuilder = options?.useWebSearch
        ? new WebSearchTraceBuilder((state) => setWebSearchTrace(state))
        : null;
      if (wsTraceBuilder) wsTraceBuilder.start();

      const docTaskPromise = retrieveNotebookDocContext(notebookId, content);
      const webPromise: Promise<WebSearchResponse | null> = options?.useWebSearch
        ? searchWeb(content).catch((err) => {
            console.warn('Notebook web search failed:', err);
            return null;
          })
        : Promise.resolve(null);

      const [{ sources, contextForAI }, webResponseRaw] = await Promise.all([
        docTaskPromise,
        webPromise,
      ]);

      const savedWebSearchResponse: WebSearchResponse | null = webResponseRaw
        ? {
            provider: webResponseRaw.provider,
            query: webResponseRaw.query,
            results: (webResponseRaw.results || []).map((r: WebSearchResult) => ({
              title: r.title,
              url: r.url,
              content: r.content,
              score: r.score,
              favicon: r.favicon,
            })),
            responseTime: webResponseRaw.responseTime,
            requestId: webResponseRaw.requestId,
            answer: webResponseRaw.answer ?? null,
            rawProviderResponse: webResponseRaw.rawProviderResponse,
          }
        : null;

      if (wsTraceBuilder) {
        wsTraceBuilder.results(savedWebSearchResponse);
        wsTraceBuilder.preparingAnswer();
      }

      // Persist web search response to dedicated table (best-effort).
      if (options?.useWebSearch && savedWebSearchResponse && insertedUserMessage?.id) {
        const rawProvider =
          savedWebSearchResponse.rawProviderResponse ??
          (savedWebSearchResponse as unknown as Record<string, unknown>);
        try {
          await persistWebSearchResponse({
            userId: user.id,
            projectId: null,
            chatId: null,
            messageId: insertedUserMessage.id,
            query: content,
            normalizedResponse: savedWebSearchResponse,
            rawResponse: rawProvider,
          });
        } catch (err) {
          console.warn('Notebook web search persistence failed:', err);
        }
      }

      const webContext = savedWebSearchResponse?.results
        ? savedWebSearchResponse.results.map((r, idx) => ({
            id: `web-${idx}`,
            title: r.title,
            url: r.url,
            content: r.content,
            score: r.score,
            favicon: r.favicon,
          }))
        : [];

      // 4. Load history (trimmed by retrieval depth)
      const { data: history } = await (supabase.from('notebook_messages' as any) as any)
        .select('role, content')
        .eq('notebook_id', notebookId)
        .order('created_at', { ascending: true });

      const contextMessages = trimChatHistory(
        (history ?? []).map((m: any) => ({ role: m.role, content: m.content })),
        retrievalDepth
      );

      // Build extra instruction for partially aligned questions
      const partialWarning = scopeAlignment === 'partially_aligned'
        ? '\n\nIMPORTANT: The user\'s question is only partially related to this notebook\'s topic. Answer ONLY using this notebook\'s sources. Do not use general knowledge. Start your response with a brief note that you\'re answering strictly from the notebook\'s sources.'
        : '';

      // 5. Call AI (notebookScope ON unless web search is enabled — web grounding overrides scope-only mode)
      const projectDesc = (notebookDescription || `Notebook: ${notebookName || 'Untitled'}`) + partialWarning;
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: contextMessages,
          projectDescription: projectDesc,
          model: resolvedModel,
          documentContext: contextForAI,
          webContext,
          notebookScope: !options?.useWebSearch,
          responseLength,
          messageOptions: options ?? { useWebSearch: false },
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ error: 'AI request failed' }));
        throw new Error(errBody.error || `AI request failed (${resp.status})`);
      }
      if (!resp.body) throw new Error('No response stream');

      // 5. Stream response
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) { fullContent += delta; setStreamingContent(fullContent); }
          } catch { buffer = line + '\n' + buffer; break; }
        }
      }

      // Mark trace done before persistence so the saved snapshot reflects completion.
      if (wsTraceBuilder) wsTraceBuilder.done();
      const finalWebSearchTrace = wsTraceBuilder ? wsTraceBuilder.snapshot() : null;

      // Merge web sources into the items list so they render in SourceAttribution.
      const webItems = savedWebSearchResponse?.results
        ? savedWebSearchResponse.results.map((r, idx) => ({
            id: `web-${idx}`,
            type: 'web' as const,
            title: r.title || 'Web result',
            snippet: (r.content || '').slice(0, 250),
            relevance: Math.max(0, Math.min(1, typeof r.score === 'number' ? r.score : 0.5)),
            url: r.url,
            favicon: r.favicon ?? null,
            score: typeof r.score === 'number' ? r.score : undefined,
          }))
        : [];

      const persistedSourcesPayload: any = {
        items: [...(sources.length > 0 ? sources : []), ...webItems],
        responseLength,
      };
      if (finalWebSearchTrace) {
        persistedSourcesPayload.augmentationMode = 'web_search';
        persistedSourcesPayload.webSearchProvider = 'tavily';
        persistedSourcesPayload.tavilyAnswer = savedWebSearchResponse?.answer ?? null;
        persistedSourcesPayload.includeAnswer = 'advanced';
        persistedSourcesPayload.searchDepth = 'basic';
        persistedSourcesPayload.webSearchTrace = finalWebSearchTrace;
      }

      // 6. Persist assistant message
      await (supabase.from('notebook_messages' as any) as any).insert({
        notebook_id: notebookId,
        user_id: user.id,
        role: 'assistant',
        content: fullContent,
        model_id: resolvedModel,
        sources: persistedSourcesPayload,
      });

      qc.invalidateQueries({ queryKey: ['notebook-messages', notebookId] });

      // 7. Auto-improve notebook title/description after first exchange
      const totalMessages = (history ?? []).filter((m: any) => m.role === 'user').length;
      if (totalMessages <= 1) {
        // This is the first exchange — trigger auto-improvement
        try {
          // Gather notebook document info for context
          const { data: nbDocs } = await (supabase.from('documents') as any)
            .select('file_name, summary')
            .eq('notebook_id', notebookId)
            .limit(10);

          const docContext = (nbDocs || []).map((d: any) => ({
            fileName: d.file_name,
            summary: d.summary || undefined,
          }));

          const resp2 = await fetch(
            getFunctionUrl('/functions/v1/improve-notebook'),
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
              },
              body: JSON.stringify({
                notebookName: notebookName || '',
                currentDescription: notebookDescription || '',
                documents: docContext,
                userMessage: content,
                assistantMessage: fullContent,
                mode: 'auto',
              }),
            }
          );

          if (resp2.ok) {
            const improved = await resp2.json();
            const updates: any = {};
            if (improved.title) updates.name = improved.title;
            if (improved.description) updates.description = improved.description;

            if (Object.keys(updates).length > 0) {
              await (supabase.from('notebooks' as any) as any)
                .update(updates)
                .eq('id', notebookId);
              qc.invalidateQueries({ queryKey: ['notebooks'] });
            }
          }
        } catch (err) {
          console.error('Auto-improve notebook failed:', err);
          // Non-critical, don't surface to user
        }
      }
    } catch (err: any) {
      console.error('Notebook chat error:', err);
      setError(err.message || 'Failed to get AI response.');
    } finally {
      setIsGenerating(false);
      setStreamingContent(null);
      setResearchTrace(null);
      setWebSearchTrace(null);
    }
  }, [user, notebookId, notebookName, notebookDescription, isGenerating, qc, retrievalDepth, responseLength, responseLengthConfig.maxOutputTokens, responseLengthConfig.strategy]);

  const clearError = useCallback(() => setError(null), []);

  return { sendMessage, isGenerating, streamingContent, error, clearError, researchTrace, webSearchTrace };
}

export function useDeleteNotebookMessagePair() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, notebookId }: { messageId: string; notebookId: string }) => {
      const { data: msg, error: msgError } = await (supabase.from('notebook_messages' as any) as any)
        .select('created_at, role')
        .eq('id', messageId)
        .single();
      if (msgError) throw msgError;

      const { data: nextMsgs } = await (supabase.from('notebook_messages' as any) as any)
        .select('id, role')
        .eq('notebook_id', notebookId)
        .gt('created_at', msg.created_at)
        .order('created_at', { ascending: true })
        .limit(1);

      const idsToDelete = [messageId];
      if (nextMsgs && nextMsgs.length > 0 && nextMsgs[0].role === 'assistant') {
        idsToDelete.push(nextMsgs[0].id);
      }

      const { error: deleteError } = await (supabase.from('notebook_messages' as any) as any)
        .delete()
        .in('id', idsToDelete);
      if (deleteError) throw deleteError;
      return idsToDelete;
    },
    onSuccess: (_, { notebookId }) => {
      qc.invalidateQueries({ queryKey: ['notebook-messages', notebookId] });
    },
  });
}
