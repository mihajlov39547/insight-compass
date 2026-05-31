export type ModelProvider = 'Google' | 'OpenAI' | 'Lovable';
export type ModelCapability = 'Thinking' | 'Web search' | 'Smart routing';

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  provider: ModelProvider;
  capabilities: ModelCapability[];
}

export const DEFAULT_MODEL_ID = 'auto';

// Picker availability is intentionally broader than task-routing defaults.
// gpt-5-mini stays available for explicit user selection, while routing remains task-based.
export const modelOptions: ModelOption[] = [
  { id: 'auto', name: 'Auto (recommended)', description: 'Chooses the best model for the task', provider: 'Lovable', capabilities: ['Smart routing'] },
  { id: 'google/gemini-3.5-flash', name: 'gemini-3.5-flash', description: 'Basic, Premium & Enterprise. Efficient Gemini 3.5 for fast coding, reasoning, and agentic workflows.', provider: 'Google', capabilities: ['Thinking'] },
  { id: 'google/gemini-2.5-flash', name: 'gemini-2.5-flash', description: 'Balanced speed and quality', provider: 'Google', capabilities: [] },
  { id: 'google/gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite', description: 'Fastest and cheapest for simple tasks', provider: 'Google', capabilities: [] },
  { id: 'google/gemini-2.5-pro', name: 'gemini-2.5-pro', description: 'Best for hard reasoning', provider: 'Google', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5-mini', name: 'gpt-5-mini', description: 'Good alternative for concise general tasks', provider: 'OpenAI', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5', name: 'gpt-5', description: 'Accuracy-critical tasks, complex decision-making, and high-quality reasoning.', provider: 'OpenAI', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5.2', name: 'gpt-5.2', description: 'Complex reasoning, deep coding and analytical workflows, and long-context knowledge tasks.', provider: 'OpenAI', capabilities: ['Thinking'] },
  { id: 'gemma-4', name: 'gemma-4', description: 'Premium-only. Google Gemma 4 with adaptive thinking and search grounding.', provider: 'Lovable', capabilities: ['Thinking', 'Web search'] },
  { id: 'gemini-3.1', name: 'gemini-3.1', description: 'Basic & Premium. Smart routing across Gemini 3.1 Flash Lite / Flash Preview / Pro with web grounding.', provider: 'Lovable', capabilities: ['Smart routing', 'Web search'] },
];
