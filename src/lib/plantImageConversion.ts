/**
 * Client-side WebP → JPEG conversion helpers for Pl@ntNet identification.
 *
 * Pl@ntNet only accepts JPEG/PNG. WebP images uploaded by users must be
 * converted to a temporary JPEG (not persisted as a plant_case_images row)
 * before being sent to the provider.
 *
 * All work happens in a browser <canvas>. Original files are never mutated.
 */

export const IDENTIFY_JPEG_MAX_SIDE = 1600;
export const IDENTIFY_JPEG_QUALITY = 0.88;
export const IDENTIFY_MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB Pl@ntNet payload cap

export function isWebpMime(mime: string | null | undefined): boolean {
  return (mime || '').toLowerCase() === 'image/webp';
}

export function isPlantnetCompatibleMime(mime: string | null | undefined): boolean {
  const m = (mime || '').toLowerCase();
  return m === 'image/jpeg' || m === 'image/jpg' || m === 'image/png';
}

export function isConvertibleForIdentification(mime: string | null | undefined): boolean {
  return isPlantnetCompatibleMime(mime) || isWebpMime(mime);
}

function loadImageBitmapFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // Keep URL alive until draw; caller-safe to revoke here.
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_decode_failed'));
    };
    img.src = url;
  });
}

/**
 * Convert a WebP (or any decodable) image Blob to a JPEG Blob using canvas.
 * Downscales so the longest side is at most `maxSide`.
 */
export async function convertImageBlobToJpeg(
  blob: Blob,
  opts: { maxSide?: number; quality?: number } = {},
): Promise<Blob> {
  const maxSide = opts.maxSide ?? IDENTIFY_JPEG_MAX_SIDE;
  const quality = opts.quality ?? IDENTIFY_JPEG_QUALITY;

  const img = await loadImageBitmapFromBlob(blob);
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) throw new Error('image_decode_failed');

  const longest = Math.max(w0, h0);
  const scale = longest > maxSide ? maxSide / longest : 1;
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  // White background so any alpha channel in the source doesn't render black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  );
  if (!out) throw new Error('canvas_encode_failed');
  return out;
}
