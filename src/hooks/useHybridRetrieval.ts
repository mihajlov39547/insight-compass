import { supabase } from '@/integrations/supabase/client';

const RETRIEVAL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hybrid-retrieval`;

export interface HybridResult {
  documentId: string;
  fileName: string;
  chunkText: string;
  chunkIndex: number;
  chunkId: string;
  similarity: number;
  keywordRank: number;
  combinedScore: number;
  matchType: 'semantic' | 'keyword' | 'hybrid' | 'chunk' | 'question';
  page: number | null;
  section: string | null;
  summary: string | null;
  projectId: string | null;
  chatId: string | null;
  notebookId: string | null;
  chunkSimilarity: number;
  questionSimilarity: number;
  keywordScore: number;
  finalScore: number;
  matchedQuestionText: string | null;
}

interface RetrievalParams {
  query: string;
  scope: 'project' | 'notebook' | 'global';
  projectId?: string;
  notebookId?: string;
  chatId?: string;
  maxResults?: number;
}

export async function hybridRetrieve(params: RetrievalParams): Promise<HybridResult[]> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];

    const resp = await fetch(RETRIEVAL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(params),
    });

    if (!resp.ok) {
      console.warn('Hybrid retrieval failed:', resp.status);
      return [];
    }

    const data = await resp.json();
    return data.results ?? [];
  } catch (e) {
    console.warn('Hybrid retrieval error:', e);
    return [];
  }
}

/** Convert hybrid results to document context for the AI chat edge function */
export function toDocumentContext(results: HybridResult[]) {
  // Group chunks by document
  const docMap = new Map<string, { fileName: string; summary?: string; excerpts: string[] }>();

  for (const r of results) {
    let entry = docMap.get(r.documentId);
    if (!entry) {
      entry = { fileName: r.fileName, summary: r.summary ?? undefined, excerpts: [] };
      docMap.set(r.documentId, entry);
    }
    if (r.chunkText) {
      entry.excerpts.push(r.chunkText);
    }
  }

  return Array.from(docMap.entries()).map(([id, doc]) => ({
    id,
    fileName: doc.fileName,
    summary: doc.summary,
    excerpt: doc.excerpts.join('\n\n').slice(0, 3000),
  }));
}

/** Convert hybrid results to source items for UI display */
export function toSources(results: HybridResult[]) {
  const sources: {
    id: string;
    title: string;
    snippet: string;
    relevance: number;
    page?: number | null;
    section?: string | null;
    documentId: string;
    chunkId: string;
    chunkIndex: number;
    matchType: string;
    matchedQuestionText: string | null;
  }[] = [];

  for (const r of results) {
    sources.push({
      id: `${r.documentId}-${r.chunkIndex}`,
      documentId: r.documentId,
      chunkId: r.chunkId,
      chunkIndex: r.chunkIndex,
      title: r.fileName,
      snippet: (r.chunkText || r.summary || '').slice(0, 250),
      relevance: r.combinedScore,
      page: r.page,
      section: r.section,
      matchType: r.matchType,
      matchedQuestionText: r.matchedQuestionText,
    });
  }

  // Deduplicate: keep top 2 chunks per document, max 8 total
  const perDoc = new Map<string, number>();
  return sources.filter(s => {
    const count = perDoc.get(s.documentId) ?? 0;
    if (count >= 2) return false;
    perDoc.set(s.documentId, count + 1);
    return true;
  }).slice(0, 8);
}
