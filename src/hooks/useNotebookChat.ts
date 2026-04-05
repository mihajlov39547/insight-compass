import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/useAuth';
import { DEFAULT_MODEL_ID } from '@/data/mockData';
import { hybridRetrieve, toDocumentContext, toSources } from '@/hooks/useHybridRetrieval';
import { trimChatHistory } from '@/lib/chatHistoryConfig';
import { useUserSettings } from '@/hooks/useUserSettings';
import { getResponseLengthConfig, normalizeResponseLength } from '@/lib/ai/responseLength';
import type { ResponseLengthStrategy } from '@/lib/ai/responseLength';

const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;
const SCOPE_CHECK_URL = `${SUPABASE_URL}/functions/v1/notebook-scope-check`;

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

    try {
      // 1. Persist user message
      await (supabase.from('notebook_messages' as any) as any).insert({
        notebook_id: notebookId,
        user_id: user.id,
        role: 'user',
        content,
        model_id: resolvedModel,
        sources: [],
      });
      qc.invalidateQueries({ queryKey: ['notebook-messages', notebookId] });

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

      // 3. Retrieve notebook doc context (Stage 2)
      const { sources, contextForAI } = await retrieveNotebookDocContext(notebookId, content);

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

      // 5. Call AI
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
          notebookScope: true,
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

      // 6. Persist assistant message
      await (supabase.from('notebook_messages' as any) as any).insert({
        notebook_id: notebookId,
        user_id: user.id,
        role: 'assistant',
        content: fullContent,
        model_id: resolvedModel,
        sources: {
          items: sources.length > 0 ? sources : [],
          responseLength,
        } as NotebookSourceMetadata,
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
            `${SUPABASE_URL}/functions/v1/improve-notebook`,
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
    }
  }, [user, notebookId, notebookName, notebookDescription, isGenerating, qc, retrievalDepth, responseLength, responseLengthConfig.maxOutputTokens, responseLengthConfig.strategy]);

  const clearError = useCallback(() => setError(null), []);

  return { sendMessage, isGenerating, streamingContent, error, clearError };
}
