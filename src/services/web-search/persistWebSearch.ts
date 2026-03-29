import { supabase } from '@/integrations/supabase/client';
import type { WebSearchResponse } from './types';

export interface PersistWebSearchParams {
  userId: string;
  projectId?: string | null;
  chatId?: string | null;
  messageId?: string | null;
  query: string;
  normalizedResponse: WebSearchResponse;
  rawResponse: Record<string, unknown>;
  status?: 'success' | 'error';
  errorMessage?: string | null;
}

export interface PersistedWebSearch {
  id: string;
  message_id: string | null;
  provider: string;
  normalized_response: WebSearchResponse;
}

/**
 * Persist a web search response to the web_search_responses table.
 * Returns the inserted row's id + key fields for downstream linkage.
 */
export async function persistWebSearchResponse(params: PersistWebSearchParams): Promise<PersistedWebSearch | null> {
  const {
    userId,
    projectId,
    chatId,
    messageId,
    query,
    normalizedResponse,
    rawResponse,
    status = 'success',
    errorMessage,
  } = params;

  const raw = rawResponse as Record<string, unknown>;

  const row = {
    user_id: userId,
    project_id: projectId ?? null,
    chat_id: chatId ?? null,
    message_id: messageId ?? null,
    provider: normalizedResponse.provider,
    query,
    provider_request_id: (normalizedResponse.requestId as string) ?? null,
    provider_response_time: (normalizedResponse.responseTime as number) ?? null,
    provider_answer: typeof raw.answer === 'string' ? raw.answer : null,
    follow_up_questions: Array.isArray(raw.follow_up_questions) ? raw.follow_up_questions : null,
    images: Array.isArray(raw.images) ? raw.images : [],
    results: normalizedResponse.results ?? [],
    raw_response: rawResponse,
    normalized_response: normalizedResponse as unknown as Record<string, unknown>,
    status,
    error_message: errorMessage ?? null,
    metadata: {},
  };

  try {
    const { data, error } = await (supabase.from('web_search_responses' as any) as any)
      .insert(row)
      .select('id, message_id, provider, normalized_response')
      .single();

    if (error) {
      console.error('Failed to persist web search response:', error);
      return null;
    }

    return data as PersistedWebSearch;
  } catch (err) {
    console.error('persistWebSearchResponse error:', err);
    return null;
  }
}
