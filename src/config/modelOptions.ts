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

// `provider` reflects the HOST of the model (where the request is served), not the maker.
// - Models called directly against Google AI Studio (Gemini/Gemma via GOOGLE_API_KEY_FREE) => 'Google'
// - Models served via the Lovable AI Gateway (OpenAI GPT-5.x family) => 'Lovable'
// - Auto routing is handled inside Lovable => 'Lovable'
export const modelOptions: ModelOption[] = [
  { id: 'auto', name: 'Auto (recommended)', description: 'Chooses the best model for the task', provider: 'Lovable', capabilities: ['Smart routing'] },
  { id: 'google/gemini-3.5-flash', name: 'gemini-3.5-flash', description: 'Basic, Premium & Enterprise. Efficient Gemini 3.5 for fast coding, reasoning, and agentic workflows.', provider: 'Google', capabilities: ['Thinking'] },
  { id: 'google/gemini-2.5-flash', name: 'gemini-2.5-flash', description: 'Balanced speed and quality', provider: 'Google', capabilities: [] },
  { id: 'google/gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite', description: 'Fastest and cheapest for simple tasks', provider: 'Google', capabilities: [] },
  { id: 'google/gemini-2.5-pro', name: 'gemini-2.5-pro', description: 'Best for hard reasoning', provider: 'Google', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5-mini', name: 'gpt-5-mini', description: 'Good alternative for concise general tasks', provider: 'Lovable', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5', name: 'gpt-5', description: 'Accuracy-critical tasks, complex decision-making, and high-quality reasoning.', provider: 'Lovable', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5.2', name: 'gpt-5.2', description: 'Complex reasoning, deep coding and analytical workflows, and long-context knowledge tasks.', provider: 'Lovable', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5.4-nano', name: 'gpt-5.4-nano', description: 'Premium-only. Fastest, cheapest GPT-5.4 — high-volume, latency-sensitive tasks.', provider: 'Lovable', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5.4-mini', name: 'gpt-5.4-mini', description: 'Premium-only. Balanced GPT-5.4 — strong reasoning at lower cost.', provider: 'Lovable', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5.4', name: 'gpt-5.4', description: 'Premium-only. Advanced reasoning, complex code generation, and analysis.', provider: 'Lovable', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5.4-pro', name: 'gpt-5.4-pro', description: 'Premium-only. Extended reasoning variant of GPT-5.4 for the hardest problems.', provider: 'Lovable', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5.5', name: 'gpt-5.5', description: 'Premium-only. State-of-the-art reasoning, coding, and instruction following.', provider: 'Lovable', capabilities: ['Thinking'] },
  { id: 'openai/gpt-5.5-pro', name: 'gpt-5.5-pro', description: 'Premium-only. Premium GPT-5.5 with extended reasoning for the most demanding tasks.', provider: 'Lovable', capabilities: ['Thinking'] },
  { id: 'gemma-4', name: 'gemma-4', description: 'Basic & Premium. Google Gemma 4 with adaptive thinking and search grounding.', provider: 'Google', capabilities: ['Thinking', 'Web search'] },
  { id: 'gemini-3.1', name: 'gemini-3.1', description: 'Basic & Premium. Smart routing across Gemini 3.1 Flash Lite / Flash Preview / Pro with web grounding.', provider: 'Google', capabilities: ['Smart routing', 'Web search'] },
];
