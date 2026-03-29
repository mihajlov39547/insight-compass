export type ResponseLengthStrategy = 'concise' | 'standard' | 'detailed';

export interface ResponseLengthConfig {
  strategy: ResponseLengthStrategy;
  instruction: string;
  maxOutputTokens: number;
}

const RESPONSE_LENGTH_CONFIG: Record<ResponseLengthStrategy, Omit<ResponseLengthConfig, 'strategy'>> = {
  concise: {
    instruction:
      'Baseline response length: concise. Lead with the direct answer first. Keep explanation minimal, avoid unnecessary background, and prefer one short paragraph (or compact bullets only when useful). If the user explicitly asks for more detail or a longer format, follow the user request.',
    maxOutputTokens: 350,
  },
  standard: {
    instruction:
      'Baseline response length: standard. Provide a direct answer plus a short explanation with moderate detail, typically around 2–3 short paragraphs. If the user explicitly asks for shorter or longer output, follow the user request.',
    maxOutputTokens: 800,
  },
  detailed: {
    instruction:
      'Baseline response length: detailed. Provide a comprehensive response with reasoning, nuance, caveats, and implementation detail when relevant, using structure where helpful. If the user explicitly asks for a shorter answer, follow the user request.',
    maxOutputTokens: 1400,
  },
};

export function normalizeResponseLength(value?: string | null): ResponseLengthStrategy {
  const normalized = (value ?? 'standard').trim().toLowerCase();
  if (normalized === 'concise') return 'concise';
  if (normalized === 'detailed') return 'detailed';
  return 'standard';
}

export function getResponseLengthConfig(value?: string | null): ResponseLengthConfig {
  const strategy = normalizeResponseLength(value);
  const config = RESPONSE_LENGTH_CONFIG[strategy];
  return {
    strategy,
    instruction: config.instruction,
    maxOutputTokens: config.maxOutputTokens,
  };
}
