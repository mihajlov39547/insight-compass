const FALLBACK_SUPABASE_URL = 'https://mdrxzwudhtmkyqcxwvcy.supabase.co';
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kcnh6d3VkaHRta3lxY3h3dmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5OTQ2NjAsImV4cCI6MjA4OTU3MDY2MH0.2EZVGthInapEDDEpTD3DSTHde92lMmCNd_H9V97gyC8';

export type RuntimeEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

function readRuntimeEnv(): RuntimeEnv {
  if (typeof window === 'undefined') return {};

  const win = window as unknown as {
    __ENV__?: RuntimeEnv;
    LOVABLE_ENV?: RuntimeEnv;
  };

  return {
    ...(win.__ENV__ ?? {}),
    ...(win.LOVABLE_ENV ?? {}),
  };
}

function pickValue(
  viteValue: string | undefined,
  runtimeValue: string | undefined,
  fallbackValue: string
): { value: string; source: 'vite' | 'runtime' | 'fallback' } {
  if (viteValue) return { value: viteValue, source: 'vite' };
  if (runtimeValue) return { value: runtimeValue, source: 'runtime' };
  return { value: fallbackValue, source: 'fallback' };
}

const runtimeEnv = readRuntimeEnv();

const urlSelection = pickValue(
  import.meta.env.VITE_SUPABASE_URL,
  runtimeEnv.VITE_SUPABASE_URL,
  FALLBACK_SUPABASE_URL
);

const keySelection = pickValue(
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
  FALLBACK_SUPABASE_PUBLISHABLE_KEY
);

export const SUPABASE_URL = urlSelection.value;
export const SUPABASE_PUBLISHABLE_KEY = keySelection.value;

export const SUPABASE_ENV_SOURCE = {
  url: urlSelection.source,
  key: keySelection.source,
} as const;

export function getFunctionUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${SUPABASE_URL}${normalized}`;
}
