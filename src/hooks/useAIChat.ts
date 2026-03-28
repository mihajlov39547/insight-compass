import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_MODEL_ID } from '@/data/mockData';
import { hybridRetrieve, toDocumentContext, toSources } from '@/hooks/useHybridRetrieval';
import { trimChatHistory } from '@/lib/chatHistoryConfig';
import { useUserSettings } from '@/hooks/useUserSettings';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const TITLE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-chat-title`;

interface UseAIChatOptions {
  chatId: string;
  chatName?: string;
  projectId?: string;
  projectDescription?: string;
}

interface MessageOptions {
  useWebSearch: boolean;
}

export function useAIChat({ chatId, chatName, projectId, projectDescription }: UseAIChatOptions) {
  const { user } = useAuth();
  const { data: userSettings } = useUserSettings();
  const qc = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedPrompt, setFailedPrompt] = useState<{ content: string; modelId: string; options?: MessageOptions } | null>(null);

  const sendMessage = useCallback(async (content: string, modelId?: string, options?: MessageOptions) => {
    if (!user || !chatId || isGenerating) return;

    const resolvedModel = modelId || DEFAULT_MODEL_ID;
    setError(null);
    setFailedPrompt(null);
    setIsGenerating(true);
    setStreamingContent('');

    try {
      // 1. Persist user message
      const { error: insertErr } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          user_id: user.id,
          role: 'user',
          content,
          sources: [],
          model_id: resolvedModel,
        });
      if (insertErr) throw insertErr;

      qc.invalidateQueries({ queryKey: ['messages', chatId] });

      // 2. Hybrid document retrieval for grounding
      let sources: { id: string; title: string; snippet: string; relevance: number }[] = [];
      let documentContext: any[] = [];
      if (projectId) {
        const results = await hybridRetrieve({
          query: content,
          scope: 'project',
          projectId,
          chatId,
          maxResults: 8,
        });
        sources = toSources(results);
        documentContext = toDocumentContext(results);
      }

      // 3. Load recent chat history (trimmed by retrieval depth)
      const retrievalDepth = userSettings?.retrieval_depth ?? 'Medium';
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
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: contextMessages,
          projectDescription: projectDescription ?? '',
          model: resolvedModel,
          documentContext,
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

      // 6. Persist assistant message with sources
      await supabase.from('messages').insert({
        chat_id: chatId,
        user_id: user.id,
        role: 'assistant',
        content: fullContent,
        sources: (sources.length > 0 ? sources : []) as any,
        model_id: resolvedModel,
      });

      // 7. Auto-rename chat if still "New Chat"
      if (chatName === 'New Chat' && fullContent) {
        fetch(TITLE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
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
      setFailedPrompt({ content, modelId: resolvedModel, options });
    } finally {
      setIsGenerating(false);
      setStreamingContent(null);
    }
  }, [user, chatId, chatName, projectId, isGenerating, qc, projectDescription]);

  const retry = useCallback(() => {
    if (failedPrompt) {
      sendMessage(failedPrompt.content, failedPrompt.modelId, failedPrompt.options);
    }
  }, [failedPrompt, sendMessage]);

  const clearError = useCallback(() => {
    setError(null);
    setFailedPrompt(null);
  }, []);

  return { sendMessage, isGenerating, streamingContent, error, clearError, retry, failedPrompt };
}
