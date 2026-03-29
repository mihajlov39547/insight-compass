export type ResponseLengthStrategy = 'concise' | 'standard' | 'detailed';

export interface ResponseLengthConfig {
  strategy: ResponseLengthStrategy;
  instruction: string;
  maxOutputTokens: number;
}

const RESPONSE_LENGTH_CONFIG: Record<ResponseLengthStrategy, Omit<ResponseLengthConfig, 'strategy'>> = {
  concise: {
    instruction:
      'Use one short paragraph with a direct answer first. Target roughly 2–4 sentences. Do not add extra background unless essential for correctness. If the user explicitly asks for more detail, follow the user request.',
    maxOutputTokens: 180,
  },
  standard: {
    instruction:
      'Use 2–3 short paragraphs. Provide a direct answer plus brief context/explanation with moderate detail. If the user explicitly asks for shorter or longer output, follow the user request.',
    maxOutputTokens: 520,
  },
  detailed: {
    instruction:
      'Use multiple short paragraphs (4+ when appropriate). Include reasoning, nuance, caveats, and implementation detail when relevant. Expand key points with practical specifics. If the user explicitly asks for a shorter answer, follow the user request.',
    maxOutputTokens: 1200,
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
