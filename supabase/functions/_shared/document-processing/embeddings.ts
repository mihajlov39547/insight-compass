// @ts-nocheck

export const EMBED_DIM = 1536;

export function hashCode(str: string, seed: number): number {
  let h = seed | 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

export function localEmbedding(text: string): number[] {
  const vec = new Float64Array(EMBED_DIM);
  const lower = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = lower.split(/\s+/).filter((w) => w.length >= 2);

  for (const w of words) {
    const idx = Math.abs(hashCode(w, 42)) % EMBED_DIM;
    const sign = (hashCode(w, 137) & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    const idx = Math.abs(hashCode(bigram, 99)) % EMBED_DIM;
    const sign = (hashCode(bigram, 211) & 1) === 0 ? 1 : -1;
    vec[idx] += sign * 0.7;
  }

  for (const w of words) {
    const padded = `#${w}#`;
    for (let i = 0; i < padded.length - 2; i++) {
      const tri = padded.slice(i, i + 3);
      const idx = Math.abs(hashCode(tri, 313)) % EMBED_DIM;
      const sign = (hashCode(tri, 479) & 1) === 0 ? 1 : -1;
      vec[idx] += sign * 0.4;
    }
  }

  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;

  const result: number[] = new Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) result[i] = vec[i] / norm;
  return result;
}

export function generateEmbeddingsLocal(texts: string[]): (number[] | null)[] {
  return texts.map((t) => {
    try {
      return localEmbedding(t);
    } catch (e) {
      console.error("Local embedding error:", e);
      return null;
    }
  });
}
