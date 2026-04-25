import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { DEFAULT_MODEL_ID } from '@/config/modelOptions';
import { getFunctionUrl, SUPABASE_PUBLISHABLE_KEY } from '@/config/env';
import { hybridRetrieve, toDocumentContext, toSources } from '@/hooks/useHybridRetrieval';
import { trimChatHistory } from '@/lib/chatHistoryConfig';
import { useUserSettings } from '@/hooks/useUserSettings';
import { searchWeb, type WebSearchResponse, type WebSearchResult } from '@/services/web-search';
import { persistWebSearchResponse } from '@/services/web-search/persistWebSearch';
import {
  WebSearchTraceBuilder,
  type WebSearchTraceState,
} from '@/services/web-search/webSearchTrace';
import { getResponseLengthConfig, normalizeResponseLength } from '@/lib/ai/responseLength';
import type { ResponseLengthStrategy } from '@/lib/ai/responseLength';
import {
  runTavilyResearch,
  researchSourcesToUnified,
  type ResearchModel,
  type ResearchTraceState,
} from '@/services/research/tavilyResearch';
import { runYouTubeSearch, youtubeSourcesToUnified } from '@/services/youtube-search';
import { isDefaultChatName } from '@/lib/chatNames';

const CHAT_URL = getFunctionUrl('/functions/v1/chat');
const TITLE_URL = getFunctionUrl('/functions/v1/generate-chat-title');

interface UseAIChatOptions {
  chatId: string;
  chatName?: string;
  projectId?: string;
  projectDescription?: string;
}

interface MessageOptions {
  useWebSearch: boolean;
  augmentationMode?: 'none' | 'web_search' | 'research' | 'youtube_search' | 'notebook';
  researchModel?: ResearchModel;
  /** When augmentationMode === 'notebook', the notebook to ground retrieval in. */
  notebookId?: string;
  notebookName?: string;
}

interface UnifiedSource {
  id: string;
  type: 'document' | 'web';
  title: string;
  snippet: string;
  relevance: number;
  page?: number | null;
  section?: string | null;
  documentId?: string;
  chunkId?: string;
  chunkIndex?: number;
  matchType?: string;
  matchedQuestionText?: string | null;
  url?: string;
  favicon?: string | null;
  score?: number;
}

interface AssistantSourceMetadata {
  documentSources: UnifiedSource[];
  webSearchResponse: WebSearchResponse | null;
  webSearchResponseId?: string | null;
  webSources: UnifiedSource[];
  combinedSources: UnifiedSource[];
  responseLength: ResponseLengthStrategy;
}

function toWebContext(results: WebSearchResult[]) {
  return results.map((r, idx) => ({
    id: `web-${idx}`,
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
    favicon: r.favicon,
  }));
}

function toWebSources(results: WebSearchResult[]): UnifiedSource[] {
  return results.map((r, idx) => {
    const rawScore = typeof r.score === 'number' ? r.score : 0;
    const normalized = Math.max(0, Math.min(1, rawScore));
    return {
      id: `web-${idx}`,
      type: 'web',
      title: r.title || 'Web result',
      snippet: (r.content || '').slice(0, 250),
      relevance: normalized,
      url: r.url,
      favicon: r.favicon ?? null,
      score: rawScore,
    };
  });
}

export function useAIChat({ chatId, chatName, projectId, projectDescription }: UseAIChatOptions) {
  const { user } = useAuth();
  const { data: userSettings } = useUserSettings();
  const retrievalDepth = userSettings?.retrieval_depth ?? 'Medium';
  const responseLength = normalizeResponseLength(userSettings?.response_length);
  const responseLengthConfig = getResponseLengthConfig(responseLength);
  const qc = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedPrompt, setFailedPrompt] = useState<{ content: string; modelId: string; options?: MessageOptions; webSearchResponse?: WebSearchResponse | null } | null>(null);
  const [researchTrace, setResearchTrace] = useState<ResearchTraceState | null>(null);
  const [webSearchTrace, setWebSearchTrace] = useState<WebSearchTraceState | null>(null);

  const sendMessage = useCallback(async (content: string, modelId?: string, options?: MessageOptions, cachedWebSearchResponse?: WebSearchResponse | null) => {
    if (!user || !chatId || isGenerating) return;

    const resolvedModel = modelId || DEFAULT_MODEL_ID;
    console.debug('[chat:length] client', {
      flow: 'project',
      responseLength,
      strategy: responseLengthConfig.strategy,
      maxOutputTokens: responseLengthConfig.maxOutputTokens,
    });
    setError(null);
    setFailedPrompt(null);
    setIsGenerating(true);
    setStreamingContent('');
    setResearchTrace(null);
    setWebSearchTrace(null);
    let resolvedWebSearchResponse: WebSearchResponse | null = cachedWebSearchResponse ?? null;

    try {
      // 1. Persist user message
      const { data: insertedUserMessage, error: insertErr } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          user_id: user.id,
          role: 'user',
          content,
          sources: [],
          model_id: resolvedModel,
        })
        .select('id')
        .single();
      if (insertErr) throw insertErr;

      qc.invalidateQueries({ queryKey: ['messages', chatId] });

      // 1b. RESEARCH MODE — short-circuit normal RAG/LLM path.
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

        const webSources = researchSourcesToUnified(researchResult.sources).map((s) => ({
          ...s,
          type: 'web' as const,
        }));

        const researchSourceMetadata: AssistantSourceMetadata = {
          documentSources: [],
          webSearchResponse: null,
          webSearchResponseId: null,
          webSources,
          combinedSources: webSources,
          responseLength,
        };

        await supabase.from('messages').insert({
          chat_id: chatId,
          user_id: user.id,
          role: 'assistant',
          content: researchResult.finalText,
          sources: {
            ...researchSourceMetadata,
            augmentationMode: 'research',
            researchProvider: 'tavily',
            researchModel: options.researchModel ?? 'auto',
            researchTrace: researchResult.trace,
          } as any,
          model_id: `tavily-research:${options.researchModel ?? 'auto'}`,
        });

        await supabase
          .from('chats')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', chatId);

        if (isDefaultChatName(chatName) && researchResult.finalText) {
          fetch(TITLE_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              userMessage: content,
              assistantMessage: researchResult.finalText,
            }),
          })
            .then((r) => r.json())
            .then(async (data) => {
              if (data.title) {
                await supabase
                  .from('chats')
                  .update({ name: data.title, updated_at: new Date().toISOString() })
                  .eq('id', chatId);
                qc.invalidateQueries({ queryKey: ['chats'] });
                qc.invalidateQueries({ queryKey: ['allChats'] });
              }
            })
            .catch((e) => console.warn('Auto-rename failed:', e.message));
        }

        qc.invalidateQueries({ queryKey: ['messages', chatId] });
        qc.invalidateQueries({ queryKey: ['chats'] });
        qc.invalidateQueries({ queryKey: ['allChats'] });
        return;
      }

      // 1c. YOUTUBE SEARCH MODE — short-circuit. Calls SerpApi YouTube and
      // persists the synthesized summary + 5 video sources as a single
      // assistant message. No RAG, no LLM streaming.
      if (options?.augmentationMode === 'youtube_search') {
        const ytResult = await runYouTubeSearch(content);
        const youtubeSources = youtubeSourcesToUnified(ytResult.sources);

        const ytSourceMetadata: AssistantSourceMetadata = {
          documentSources: [],
          webSearchResponse: null,
          webSearchResponseId: null,
          webSources: youtubeSources as any,
          combinedSources: youtubeSources as any,
          responseLength,
        };

        await supabase.from('messages').insert({
          chat_id: chatId,
          user_id: user.id,
          role: 'assistant',
          content: ytResult.synthesizedAnswer,
          sources: {
            ...ytSourceMetadata,
            augmentationMode: 'youtube_search',
            youtubeProvider: 'serpapi',
            youtubeQuery: ytResult.query,
            youtubeSources: ytResult.sources,
            synthesisModel: ytResult.synthesisModel,
            synthesisError: ytResult.synthesisError,
          } as any,
          model_id: ytResult.synthesisModel ?? 'serpapi-youtube-search',
        });

        await supabase
          .from('chats')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', chatId);

        if (isDefaultChatName(chatName) && ytResult.synthesizedAnswer) {
          fetch(TITLE_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              userMessage: content,
              assistantMessage: ytResult.synthesizedAnswer,
            }),
          })
            .then((r) => r.json())
            .then(async (data) => {
              if (data.title) {
                await supabase
                  .from('chats')
                  .update({ name: data.title, updated_at: new Date().toISOString() })
                  .eq('id', chatId);
                qc.invalidateQueries({ queryKey: ['chats'] });
                qc.invalidateQueries({ queryKey: ['allChats'] });
              }
            })
            .catch((e) => console.warn('Auto-rename failed:', e.message));
        }

        qc.invalidateQueries({ queryKey: ['messages', chatId] });
        qc.invalidateQueries({ queryKey: ['chats'] });
        qc.invalidateQueries({ queryKey: ['allChats'] });
        return;
      }

      const isNotebookMode = options?.augmentationMode === 'notebook' && !!options?.notebookId;
      const docPromise = isNotebookMode
        ? hybridRetrieve({
            query: content,
            scope: 'notebook',
            notebookId: options!.notebookId!,
            maxResults: 8,
          })
        : projectId
        ? hybridRetrieve({
            query: content,
            scope: 'project',
            projectId,
            chatId,
            maxResults: 8,
          })
        : Promise.resolve([]);

      // Build a lightweight trace for the web-search flow so the UI can show
      // staged progress (Searching → Found sources → Preparing answer → Complete).
      const wsTraceBuilder = options?.useWebSearch
        ? new WebSearchTraceBuilder((state) => setWebSearchTrace(state))
        : null;
      if (wsTraceBuilder) wsTraceBuilder.start();

      const webPromise = options?.useWebSearch
        ? (cachedWebSearchResponse
            ? Promise.resolve(cachedWebSearchResponse)
            : searchWeb(content).catch((err) => {
                console.warn('Web search failed:', err);
                return null;
              }))
        : Promise.resolve(null);

      const [docResults, webResponseRaw] = await Promise.all([docPromise, webPromise]);

      const savedWebSearchResponse: WebSearchResponse | null = webResponseRaw
        ? {
            provider: webResponseRaw.provider,
            query: webResponseRaw.query,
            results: (webResponseRaw.results || []).map((r) => ({
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
      resolvedWebSearchResponse = savedWebSearchResponse;

      if (wsTraceBuilder) {
        wsTraceBuilder.results(savedWebSearchResponse);
        wsTraceBuilder.preparingAnswer();
      }

      // Persist web search response to dedicated table and capture ID
      let webSearchResponseId: string | null = null;
      if (options?.useWebSearch && savedWebSearchResponse && insertedUserMessage?.id) {
        const rawProvider = savedWebSearchResponse.rawProviderResponse ?? savedWebSearchResponse as unknown as Record<string, unknown>;
        try {
          const persisted = await persistWebSearchResponse({
            userId: user.id,
            projectId: projectId ?? null,
            chatId,
            messageId: insertedUserMessage.id,
            query: content,
            normalizedResponse: savedWebSearchResponse,
            rawResponse: rawProvider,
          });
          if (persisted) {
            webSearchResponseId = persisted.id;
            console.log('[web-search] persisted row id:', persisted.id);
          }
        } catch (err) {
          console.warn('Web search persistence failed:', err);
        }
      }

      const documentSources = toSources(docResults).map((s) => ({ ...s, type: 'document' as const }));
      const webSources = savedWebSearchResponse?.results ? toWebSources(savedWebSearchResponse.results) : [];
      const sources: UnifiedSource[] = [...documentSources, ...webSources];

      const documentContext = toDocumentContext(docResults);
      const webContext = savedWebSearchResponse?.results ? toWebContext(savedWebSearchResponse.results) : [];

      const fallbackDocSources: UnifiedSource[] = documentContext.map((doc: any, idx: number) => ({
        id: doc.id || `doc-fallback-${idx}`,
        type: 'document',
        title: doc.fileName || `Document ${idx + 1}`,
        snippet: (doc.excerpt || doc.summary || '').slice(0, 250),
        relevance: 0.65,
        documentId: doc.id,
      }));

      const fallbackWebSources: UnifiedSource[] = webContext.map((web: any, idx: number) => ({
        id: web.id || `web-fallback-${idx}`,
        type: 'web',
        title: web.title || `Web result ${idx + 1}`,
        snippet: (web.content || '').slice(0, 250),
        relevance: Math.max(0, Math.min(1, typeof web.score === 'number' ? web.score : 0.5)),
        url: web.url,
        favicon: web.favicon ?? null,
        score: typeof web.score === 'number' ? web.score : undefined,
      }));

      const persistedSources: UnifiedSource[] =
        sources.length > 0 ? sources : [...fallbackDocSources, ...fallbackWebSources];

      const assistantSourceMetadata: AssistantSourceMetadata = {
        documentSources: documentSources.length > 0 ? documentSources : fallbackDocSources,
        webSearchResponse: savedWebSearchResponse,
        webSearchResponseId,
        webSources: webSources.length > 0 ? webSources : fallbackWebSources,
        combinedSources: persistedSources,
        responseLength,
      };

      // 3. Load recent chat history (trimmed by retrieval depth)
      const { data: history } = await supabase
        .from('messages')
        .select('role, content')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

      const contextMessages = trimChatHistory(
        (history ?? []).map((m: any) => ({ role: m.role, content: m.content })),
        retrievalDepth
      );

      // 4. Call AI edge function with document context
      const notebookProjectDescription = isNotebookMode && options?.notebookName
        ? `Notebook: ${options.notebookName}`
        : (projectDescription ?? '');

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: contextMessages,
          projectDescription: notebookProjectDescription,
          model: resolvedModel,
          documentContext,
          webContext,
          notebookScope: isNotebookMode,
          responseLength,
          messageOptions: options ?? { useWebSearch: false },
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ error: 'AI request failed' }));
        throw new Error(errBody.error || `AI request failed (${resp.status})`);
      }

      if (!resp.body) throw new Error('No response stream');

      // 5. Stream the response
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
            if (delta) {
              fullContent += delta;
              setStreamingContent(fullContent);
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      // Mark trace done before persisting so the saved snapshot reflects completion.
      if (wsTraceBuilder) wsTraceBuilder.done();
      const finalWebSearchTrace = wsTraceBuilder ? wsTraceBuilder.snapshot() : null;

      // 6. Persist assistant message with sources (+ optional web search / notebook trace metadata)
      let persistedSourcesPayload: any = assistantSourceMetadata;
      if (finalWebSearchTrace) {
        persistedSourcesPayload = {
          ...assistantSourceMetadata,
          augmentationMode: 'web_search',
          webSearchProvider: 'tavily',
          tavilyAnswer: savedWebSearchResponse?.answer ?? null,
          includeAnswer: 'advanced',
          searchDepth: 'basic',
          webSearchTrace: finalWebSearchTrace,
        };
      } else if (isNotebookMode) {
        persistedSourcesPayload = {
          ...assistantSourceMetadata,
          augmentationMode: 'notebook',
          notebookId: options?.notebookId,
          notebookName: options?.notebookName,
        };
      }

      await supabase.from('messages').insert({
        chat_id: chatId,
        user_id: user.id,
        role: 'assistant',
        content: fullContent,
        sources: persistedSourcesPayload,
        model_id: resolvedModel,
      });

      // 7. Auto-rename chat if still "New Chat"
      if (isDefaultChatName(chatName) && fullContent) {
        fetch(TITLE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            userMessage: content,
            assistantMessage: fullContent,
          }),
        })
          .then(r => r.json())
          .then(async (data) => {
            if (data.title) {
              await supabase
                .from('chats')
                .update({ name: data.title, updated_at: new Date().toISOString() })
                .eq('id', chatId);
              qc.invalidateQueries({ queryKey: ['chats'] });
              qc.invalidateQueries({ queryKey: ['allChats'] });
            }
          })
          .catch((e) => console.warn('Auto-rename failed:', e.message));
      }

      // 8. Update chat timestamp
      await supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);

      // 9. Refresh queries
      qc.invalidateQueries({ queryKey: ['messages', chatId] });
      qc.invalidateQueries({ queryKey: ['chats'] });
      qc.invalidateQueries({ queryKey: ['allChats'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (err: any) {
      console.error('AI chat error:', err);
      setError(err.message || 'Failed to get AI response. Please try again.');
      setFailedPrompt({ content, modelId: resolvedModel, options, webSearchResponse: resolvedWebSearchResponse });
    } finally {
      setIsGenerating(false);
      setStreamingContent(null);
      setResearchTrace(null);
      setWebSearchTrace(null);
    }
  }, [user, chatId, chatName, projectId, isGenerating, qc, projectDescription, retrievalDepth, responseLength, responseLengthConfig.maxOutputTokens, responseLengthConfig.strategy]);

  const retry = useCallback(() => {
    if (failedPrompt) {
      sendMessage(failedPrompt.content, failedPrompt.modelId, failedPrompt.options, failedPrompt.webSearchResponse ?? null);
    }
  }, [failedPrompt, sendMessage]);

  const clearError = useCallback(() => {
    setError(null);
    setFailedPrompt(null);
  }, []);

  return { sendMessage, isGenerating, streamingContent, error, clearError, retry, failedPrompt, researchTrace, webSearchTrace };
}
