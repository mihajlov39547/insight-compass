/**
 * Centralized chat history depth config.
 * Maps Retrieval Depth setting to the number of recent turns (1 turn = 1 user + 1 assistant message).
 */

const TURNS_BY_DEPTH: Record<string, number> = {
  Shallow: 2,
  Medium: 4,
  Deep: 8,
};

/** Returns the max number of individual messages (user + assistant) to include in the prompt. */
export function getChatHistoryLimit(retrievalDepth: string): number {
  const turns = TURNS_BY_DEPTH[retrievalDepth] ?? TURNS_BY_DEPTH.Medium;
  return turns * 2; // each turn = 1 user + 1 assistant
}

/** Trims a chronological message list to the last N user+assistant messages based on retrieval depth. */
export function trimChatHistory(
  messages: { role: string; content: string }[],
  retrievalDepth: string
): { role: string; content: string }[] {
  const limit = getChatHistoryLimit(retrievalDepth);
  const relevant = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  return relevant.slice(-limit);
}
