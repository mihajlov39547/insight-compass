import JSZip from 'jszip';
import { supabase } from '@/integrations/supabase/client';

export interface ZipItem {
  storagePath: string;
  filename: string;
}

export interface ZipDownloadResult {
  added: number;
  failed: number;
}

const ALREADY_COMPRESSED = /\.(zip|7z|rar|gz|png|jpe?g|webp|gif|mp4|mp3|docx|xlsx|pptx)$/i;

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'file';
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${base} (${i})${ext}`.toLowerCase())) i++;
  const n = `${base} (${i})${ext}`;
  used.add(n.toLowerCase());
  return n;
}

/**
 * Builds a ZIP in browser memory and saves it. The archive is never uploaded
 * or stored anywhere; the in-memory URL is released shortly after download.
 */
export async function downloadFilesAsZip(items: ZipItem[], zipName: string): Promise<ZipDownloadResult> {
  const zip = new JSZip();
  const used = new Set<string>();
  let added = 0;
  let failed = 0;

  const queue = [...items];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()!;
      try {
        const { data, error } = await supabase.storage
          .from('insight-navigator')
          .createSignedUrl(item.storagePath, 60);
        if (error || !data?.signedUrl) throw error || new Error('No URL');
        const resp = await fetch(data.signedUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const name = uniqueName(sanitize(item.filename), used);
        zip.file(name, blob, { compression: ALREADY_COMPRESSED.test(name) ? 'STORE' : 'DEFLATE' });
        added++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));

  if (added === 0) return { added, failed };

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { added, failed };
}

export function zipTimestampName(prefix: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${sanitize(prefix)}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.zip`;
}
