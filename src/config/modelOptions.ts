export interface ModelOption {
  id: string;
  name: string;
  description: string;
}

export const DEFAULT_MODEL_ID = 'auto';

// Picker availability is intentionally broader than task-routing defaults.
// gpt-5-mini stays available for explicit user selection, while routing remains task-based.
export const modelOptions: ModelOption[] = [
  { id: 'auto', name: 'Auto (recommended)', description: 'Chooses the best model for the task' },
  { id: 'google/gemini-3-flash-preview', name: 'gemini-3-flash-preview', description: 'Best default for everyday chat' },
  { id: 'google/gemini-2.5-flash', name: 'gemini-2.5-flash', description: 'Balanced speed and quality' },
  { id: 'google/gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite', description: 'Fastest and cheapest for simple tasks' },
  { id: 'google/gemini-2.5-pro', name: 'gemini-2.5-pro', description: 'Best for hard reasoning' },
  { id: 'openai/gpt-5-mini', name: 'gpt-5-mini', description: 'Good alternative for concise general tasks' },
  { id: 'openai/gpt-5', name: 'gpt-5', description: 'Accuracy-critical tasks, complex decision-making, and high-quality reasoning.' },
  { id: 'openai/gpt-5.2', name: 'gpt-5.2', description: 'Complex reasoning, deep coding and analytical workflows, and long-context knowledge tasks.' },
];
