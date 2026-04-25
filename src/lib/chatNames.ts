export const DEFAULT_CHAT_NAMES = ['New Chat', 'Novi čet'] as const;

export function isDefaultChatName(name?: string | null) {
  if (!name) return false;
  const normalizedName = name.trim().toLocaleLowerCase();
  return DEFAULT_CHAT_NAMES.some(defaultName => (
    defaultName.toLocaleLowerCase() === normalizedName
  ));
}
