// @ts-nocheck

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;
export const MIN_CHUNK_LENGTH = 50;

export interface TextChunk {
  chunk_text: string;
  chunk_index: number;
}

export function findSplitPoint(text: string, target: number): number {
  const region = text.slice(Math.max(0, target - 200), Math.min(text.length, target + 200));
  const sentenceEnd = region.search(/[.!?]\s/);
  if (sentenceEnd !== -1) {
    return Math.max(0, target - 200) + sentenceEnd + 2;
  }
  const lastSpace = text.lastIndexOf(" ", target);
  return lastSpace > target * 0.5 ? lastSpace : target;
}

export function chunkText(text: string): TextChunk[] {
  if (!text || text.trim().length < MIN_CHUNK_LENGTH) return [];

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: TextChunk[] = [];

  let currentChunk = "";
  let chunkIndex = 0;

  for (const para of paragraphs) {
    if (
      currentChunk.length > 0 &&
      currentChunk.length + para.length + 1 > CHUNK_SIZE
    ) {
      if (currentChunk.trim().length >= MIN_CHUNK_LENGTH) {
        chunks.push({ chunk_text: currentChunk.trim(), chunk_index: chunkIndex++ });
      }

      const overlapText = currentChunk.slice(-CHUNK_OVERLAP).trim();
      currentChunk = overlapText ? `${overlapText}\n\n${para}` : para;
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
    }

    while (currentChunk.length > CHUNK_SIZE * 1.5) {
      const splitAt = findSplitPoint(currentChunk, CHUNK_SIZE);
      const piece = currentChunk.slice(0, splitAt).trim();
      if (piece.length >= MIN_CHUNK_LENGTH) {
        chunks.push({ chunk_text: piece, chunk_index: chunkIndex++ });
      }
      const overlapStart = Math.max(0, splitAt - CHUNK_OVERLAP);
      currentChunk = currentChunk.slice(overlapStart).trim();
    }
  }

  if (currentChunk.trim().length >= MIN_CHUNK_LENGTH) {
    chunks.push({ chunk_text: currentChunk.trim(), chunk_index: chunkIndex++ });
  }

  return chunks;
}

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3.5);
}
