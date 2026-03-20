import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_MODEL_ID } from '@/data/mockData';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const TITLE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-chat-title`;

interface UseAIChatOptions {
  chatId: string;
  projectDescription?: string;
}

export function useAIChat({ chatId, projectDescription }: UseAIChatOptions) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedPrompt, setFailedPrompt] = useState<{ content: string; modelId: string } | null>(null);

  const sendMessage = useCallback(async (content: string, modelId?: string) => {
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

      // 2. Load recent chat history
      const { data: history } = await supabase
        .from('messages')
        .select('role, content')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })
        .limit(50);

      const contextMessages = (history ?? [])
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => ({ role: m.role, content: m.content }));

      // 3. Call AI edge function with model
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
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ error: 'AI request failed' }));
        throw new Error(errBody.error || `AI request failed (${resp.status})`);
      }

      if (!resp.body) throw new Error('No response stream');

      // 4. Stream the response
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

      // 5. Persist assistant message with model used
      await supabase.from('messages').insert({
        chat_id: chatId,
        user_id: user.id,
        role: 'assistant',
        content: fullContent,
        sources: [],
        model_id: resolvedModel,
      });

      // 6. Update chat timestamp
      await supabase
        .from('chats')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', chatId);

      // 7. Refresh queries
      qc.invalidateQueries({ queryKey: ['messages', chatId] });
      qc.invalidateQueries({ queryKey: ['chats'] });
      qc.invalidateQueries({ queryKey: ['allChats'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (err: any) {
      console.error('AI chat error:', err);
      setError(err.message || 'Failed to get AI response. Please try again.');
      setFailedPrompt({ content, modelId: resolvedModel });
    } finally {
      setIsGenerating(false);
      setStreamingContent(null);
    }
  }, [user, chatId, isGenerating, qc, projectDescription]);

  const retry = useCallback(() => {
    if (failedPrompt) {
      // Don't re-insert user message on retry — it was already saved
      // Instead, call AI directly with the same context
      sendMessage(failedPrompt.content, failedPrompt.modelId);
    }
  }, [failedPrompt, sendMessage]);

  const clearError = useCallback(() => {
    setError(null);
    setFailedPrompt(null);
  }, []);

  return { sendMessage, isGenerating, streamingContent, error, clearError, retry, failedPrompt };
}
