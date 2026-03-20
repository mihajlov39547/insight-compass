import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_MODEL_ID } from '@/data/mockData';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const TITLE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-chat-title`;

interface UseAIChatOptions {
  chatId: string;
  chatName?: string;
  projectId?: string;
  projectDescription?: string;
}

interface DocumentSource {
  id: string;
  title: string;
  snippet: string;
  relevance: number;
}

/** Retrieve relevant documents for grounding — chat docs first, then project docs */
async function retrieveDocumentContext(
  projectId: string,
  chatId: string,
  userMessage: string
): Promise<{ sources: DocumentSource[]; contextForAI: { id: string; fileName: string; summary?: string; excerpt?: string }[] }> {
  try {
    // 1. Search using the RPC for keyword matches
    const { data: searchResults } = await supabase.rpc('search_documents', {
      search_query: userMessage,
    });

    // 2. Also fetch all completed docs for this chat + project as fallback context
    const { data: scopedDocs } = await supabase
      .from('documents')
      .select('id, file_name, summary, chat_id, project_id, processing_status')
      .eq('project_id', projectId)
      .eq('processing_status', 'completed')
      .limit(50);

    // Build a map of doc IDs to their analysis text
    const relevantDocIds = new Set<string>();
    const docSnippets = new Map<string, string>();

    // Add search-matched docs (highest priority)
    if (searchResults) {
      for (const r of searchResults) {
        // Only include docs in scope (same project)
        if (r.project_id === projectId) {
          relevantDocIds.add(r.document_id);
          if (r.snippet) docSnippets.set(r.document_id, r.snippet);
        }
      }
    }

    // Prioritize chat docs, then project docs
    const chatDocs = (scopedDocs ?? []).filter(d => d.chat_id === chatId);
    const projectDocs = (scopedDocs ?? []).filter(d => !d.chat_id);

    // Add chat docs that aren't already matched by search
    for (const d of chatDocs) {
      relevantDocIds.add(d.id);
    }
    // Add project docs (lower priority, limited)
    for (const d of projectDocs.slice(0, 10)) {
      relevantDocIds.add(d.id);
    }

    if (relevantDocIds.size === 0) {
      return { sources: [], contextForAI: [] };
    }

    // Fetch analysis excerpts for relevant docs
    const { data: analyses } = await supabase
      .from('document_analysis')
      .select('document_id, extracted_text, normalized_search_text')
      .in('document_id', Array.from(relevantDocIds));

    const analysisMap = new Map<string, { extracted_text: string | null; normalized_search_text: string | null }>();
    if (analyses) {
      for (const a of analyses) {
        analysisMap.set(a.document_id, a);
      }
    }

    // Build all docs map
    const allDocsMap = new Map<string, typeof scopedDocs extends (infer T)[] | null ? NonNullable<T> : never>();
    for (const d of [...chatDocs, ...projectDocs]) {
      allDocsMap.set(d.id, d);
    }

    // Build sources and context — chat docs first, then search-ranked, then project docs
    const orderedIds: string[] = [];
    const seen = new Set<string>();

    // Chat docs first
    for (const d of chatDocs) {
      if (!seen.has(d.id)) { orderedIds.push(d.id); seen.add(d.id); }
    }
    // Search results second (already ranked)
    if (searchResults) {
      for (const r of searchResults) {
        if (r.project_id === projectId && !seen.has(r.document_id)) {
          orderedIds.push(r.document_id); seen.add(r.document_id);
        }
      }
    }
    // Remaining project docs
    for (const d of projectDocs) {
      if (!seen.has(d.id)) { orderedIds.push(d.id); seen.add(d.id); }
    }

    // Limit to top 8 docs for context window management
    const topIds = orderedIds.slice(0, 8);

    const sources: DocumentSource[] = [];
    const contextForAI: { id: string; fileName: string; summary?: string; excerpt?: string }[] = [];

    for (const docId of topIds) {
      const doc = allDocsMap.get(docId);
      if (!doc) continue;

      const analysis = analysisMap.get(docId);
      const snippet = docSnippets.get(docId) ?? doc.summary ?? '';
      const searchResult = searchResults?.find((r: any) => r.document_id === docId);
      const relevance = searchResult?.rank ? Math.min(searchResult.rank * 10, 1) : 0.3;

      sources.push({
        id: docId,
        title: doc.file_name,
        snippet: snippet.slice(0, 200),
        relevance,
      });

      // Build excerpt for AI — limit to ~2000 chars per doc
      let excerpt = '';
      if (analysis?.extracted_text) {
        excerpt = analysis.extracted_text.slice(0, 2000);
      } else if (analysis?.normalized_search_text) {
        excerpt = analysis.normalized_search_text.slice(0, 2000);
      }

      contextForAI.push({
        id: docId,
        fileName: doc.file_name,
        summary: doc.summary ?? undefined,
        excerpt: excerpt || undefined,
      });
    }

    return { sources, contextForAI };
  } catch (err) {
    console.warn('Document retrieval failed, proceeding without grounding:', err);
    return { sources: [], contextForAI: [] };
  }
}

export function useAIChat({ chatId, chatName, projectId, projectDescription }: UseAIChatOptions) {
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

      // 2. Retrieve relevant documents for grounding
      let sources: DocumentSource[] = [];
      let documentContext: any[] = [];
      if (projectId) {
        const retrieval = await retrieveDocumentContext(projectId, chatId, content);
        sources = retrieval.sources;
        documentContext = retrieval.contextForAI;
      }

      // 3. Load recent chat history
      const { data: history } = await supabase
        .from('messages')
        .select('role, content')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })
        .limit(50);

      const contextMessages = (history ?? [])
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => ({ role: m.role, content: m.content }));

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
        sources: sources.length > 0 ? sources : [],
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
      setFailedPrompt({ content, modelId: resolvedModel });
    } finally {
      setIsGenerating(false);
      setStreamingContent(null);
    }
  }, [user, chatId, chatName, projectId, isGenerating, qc, projectDescription]);

  const retry = useCallback(() => {
    if (failedPrompt) {
      sendMessage(failedPrompt.content, failedPrompt.modelId);
    }
  }, [failedPrompt, sendMessage]);

  const clearError = useCallback(() => {
    setError(null);
    setFailedPrompt(null);
  }, []);

  return { sendMessage, isGenerating, streamingContent, error, clearError, retry, failedPrompt };
}
