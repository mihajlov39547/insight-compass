// Client helper for the plant-case-localize edge function.
// Rewrites Tavily extract/crawl output in the Plant Advisor identification
// language before it is saved to a plant case chat message.

import { getFunctionUrl } from '@/config/env';
import { authedFetchHeaders } from '@/lib/edge/invokeWithAuth';

export interface LocalizePlantCaseContentInput {
  content: string;
  lang: 'en' | 'sr';
  question?: string | null;
  mode: 'extract' | 'crawl';
}

export interface LocalizePlantCaseContentResult {
  content: string | null;
  model: string | null;
  error: string | null;
}

const LOCALIZE_URL = getFunctionUrl('/functions/v1/plant-case-localize');

/**
 * Best-effort: on any failure the caller keeps the raw content.
 */
export async function localizePlantCaseContent(
  input: LocalizePlantCaseContentInput,
): Promise<LocalizePlantCaseContentResult> {
  try {
    const resp = await fetch(LOCALIZE_URL, {
      method: 'POST',
      headers: await authedFetchHeaders(),
      body: JSON.stringify({
        content: input.content,
        lang: input.lang,
        question: input.question ?? null,
        mode: input.mode,
      }),
    });

    if (!resp.ok) {
      return { content: null, model: null, error: `Localization failed (${resp.status})` };
    }

    const data = (await resp.json()) as LocalizePlantCaseContentResult;
    return {
      content: typeof data?.content === 'string' && data.content.trim() ? data.content : null,
      model: data?.model ?? null,
      error: data?.error ?? null,
    };
  } catch (err) {
    return {
      content: null,
      model: null,
      error: err instanceof Error ? err.message : 'Localization failed',
    };
  }
}
