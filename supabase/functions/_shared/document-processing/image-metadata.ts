// @ts-nocheck

export interface ImageMetadataResult {
  width: number | null;
  height: number | null;
  format: string | null;
  warning?: string;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function parsePng(bytes: Uint8Array): ImageMetadataResult | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return null;
  }
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return { width, height, format: "png" };
}

function parseGif(bytes: Uint8Array): ImageMetadataResult | null {
  if (bytes.length < 10) return null;
  const header = String.fromCharCode(...bytes.slice(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") return null;
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  return { width, height, format: "gif" };
}

function parseWebp(bytes: Uint8Array): ImageMetadataResult | null {
  if (bytes.length < 30) return null;
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff !== "RIFF" || webp !== "WEBP") return null;

  const chunkType = String.fromCharCode(...bytes.slice(12, 16));

  if (chunkType === "VP8X" && bytes.length >= 30) {
    const widthMinusOne = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
    const heightMinusOne = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
    return {
      width: widthMinusOne + 1,
      height: heightMinusOne + 1,
      format: "webp",
    };
  }

  return { width: null, height: null, format: "webp", warning: "WEBP parsed without VP8X dimensions" };
}

function parseJpeg(bytes: Uint8Array): ImageMetadataResult | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }

    if (offset + 2 > bytes.length) break;
    const length = readUint16BE(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;

    const isSOF = (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    );

    if (isSOF) {
      if (offset + 7 > bytes.length) break;
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      return { width, height, format: "jpeg" };
    }

    offset += length;
  }

  return { width: null, height: null, format: "jpeg", warning: "JPEG dimensions not found" };
}

export function extractImageMetadata(bytes: Uint8Array): ImageMetadataResult {
  const parsers = [parsePng, parseJpeg, parseGif, parseWebp];
  for (const parser of parsers) {
    const result = parser(bytes);
    if (result) return result;
  }
  return {
    width: null,
    height: null,
    format: null,
    warning: "Unsupported or unrecognized image format",
  };
}
