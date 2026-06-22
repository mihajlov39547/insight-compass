/**
 * Centralized chat history depth config.
 * The number of recent chat turns (1 turn = 1 user + 1 assistant message)
 * sent to the model is determined by the user's subscription plan.
 *
 * Plan mapping:
 *   free        ->  2 turns /  4 messages
 *   basic       ->  5 turns / 10 messages
 *   premium     -> 10 turns / 20 messages
 *   enterprise  -> 10 turns / 20 messages
 *
 * Unknown / missing plans fall back to `free` to fail safely.
 */

import { normalizePlan, type Plan } from '@/types/app';

export type SubscriptionPlan = Plan;

export interface ChatHistoryLimit {
  plan: SubscriptionPlan;
  turns: number;
  messages: number;
}

export const CHAT_HISTORY_LIMITS_BY_PLAN: Record<SubscriptionPlan, { turns: number; messages: number }> = {
  free: { turns: 2, messages: 4 },
  basic: { turns: 5, messages: 10 },
  premium: { turns: 10, messages: 20 },
  enterprise: { turns: 10, messages: 20 },
};

/** Returns the chat history limit (turns + messages) for a given plan, falling back to `free`. */
export function getChatHistoryLimitForPlan(plan: string | null | undefined): ChatHistoryLimit {
  const normalized = normalizePlan(plan);
  const limit = CHAT_HISTORY_LIMITS_BY_PLAN[normalized] ?? CHAT_HISTORY_LIMITS_BY_PLAN.free;
  return { plan: normalized, turns: limit.turns, messages: limit.messages };
}

/**
 * Trims a chronological message list to the last N user+assistant messages
 * allowed by the user's subscription plan.
 *
 * - Filters out non user/assistant roles (system, tool, etc.)
 * - Preserves the most recent messages
 * - Returns the input untouched when fewer messages exist than the plan limit
 */
export function trimChatHistoryForPlan<T extends { role: string }>(
  messages: T[],
  plan: string | null | undefined
): T[] {
  const { messages: limit } = getChatHistoryLimitForPlan(plan);
  const relevant = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  return relevant.slice(-limit);
}

// -----------------------------------------------------------------------------
// Legacy retrieval-depth helpers (kept for backwards compatibility).
// Chat transcript history is now plan-based; do not use these for new code.
// -----------------------------------------------------------------------------

const TURNS_BY_DEPTH: Record<string, number> = {
  Shallow: 2,
  Medium: 4,
  Deep: 8,
};

/** @deprecated Use getChatHistoryLimitForPlan instead. */
export function getChatHistoryLimit(retrievalDepth: string): number {
  const turns = TURNS_BY_DEPTH[retrievalDepth] ?? TURNS_BY_DEPTH.Medium;
  return turns * 2;
}

/** @deprecated Use trimChatHistoryForPlan instead. */
export function trimChatHistory(
  messages: { role: string; content: string }[],
  retrievalDepth: string
): { role: string; content: string }[] {
  const limit = getChatHistoryLimit(retrievalDepth);
  const relevant = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  return relevant.slice(-limit);
}
