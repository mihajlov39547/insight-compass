import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_MODEL_ID } from '@/data/mockData';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

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

/** Retrieve notebook document context for grounding (only enabled docs) */
async function retrieveNotebookDocContext(notebookId: string, userMessage: string) {
  try {
    const { data: docs } = await (supabase.from('documents') as any)
      .select('id, file_name, summary, processing_status, notebook_enabled')
      .eq('notebook_id', notebookId)
      .eq('processing_status', 'completed')
      .eq('notebook_enabled', true)
      .limit(20);

    if (!docs || docs.length === 0) return { sources: [], contextForAI: [] };

    const docIds = docs.map((d: any) => d.id);
    const { data: analyses } = await supabase
      .from('document_analysis')
      .select('document_id, extracted_text, normalized_search_text')
      .in('document_id', docIds);

    const analysisMap = new Map<string, any>();
    if (analyses) {
      for (const a of analyses) analysisMap.set(a.document_id, a);
    }

    const sources: any[] = [];
    const contextForAI: any[] = [];

    for (const doc of docs) {
      const analysis = analysisMap.get(doc.id);
      let excerpt = '';
      if (analysis?.extracted_text) excerpt = analysis.extracted_text.slice(0, 2000);
      else if (analysis?.normalized_search_text) excerpt = analysis.normalized_search_text.slice(0, 2000);

      sources.push({ id: doc.id, title: doc.file_name, snippet: (doc.summary || '').slice(0, 200), relevance: 0.5 });
      contextForAI.push({ id: doc.id, fileName: doc.file_name, summary: doc.summary || undefined, excerpt: excerpt || undefined });
    }

    return { sources, contextForAI };
  } catch {
    return { sources: [], contextForAI: [] };
  }
}

export function useNotebookAIChat({ notebookId, notebookName, notebookDescription }: UseNotebookAIChatOptions) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (content: string, modelId?: string) => {
    if (!user || !notebookId || isGenerating) return;
    const resolvedModel = modelId || DEFAULT_MODEL_ID;
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

      // 2. Retrieve notebook doc context
      const { sources, contextForAI } = await retrieveNotebookDocContext(notebookId, content);

      // 3. Load history
      const { data: history } = await (supabase.from('notebook_messages' as any) as any)
        .select('role, content')
        .eq('notebook_id', notebookId)
        .order('created_at', { ascending: true })
        .limit(50);

      const contextMessages = (history ?? [])
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => ({ role: m.role, content: m.content }));

      // 4. Call AI
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: contextMessages,
          projectDescription: notebookDescription || `Notebook: ${notebookName || 'Untitled'}`,
          model: resolvedModel,
          documentContext: contextForAI,
          notebookScope: true,
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
        sources: sources.length > 0 ? sources : [],
      });

      qc.invalidateQueries({ queryKey: ['notebook-messages', notebookId] });
    } catch (err: any) {
      console.error('Notebook chat error:', err);
      setError(err.message || 'Failed to get AI response.');
    } finally {
      setIsGenerating(false);
      setStreamingContent(null);
    }
  }, [user, notebookId, notebookName, notebookDescription, isGenerating, qc]);

  const clearError = useCallback(() => setError(null), []);

  return { sendMessage, isGenerating, streamingContent, error, clearError };
}
