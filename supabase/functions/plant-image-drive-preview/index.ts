// Streams a plant image preview from Google Drive through the backend so the
// browser never needs Drive credentials. Prefers Drive's thumbnailLink; falls
// back to serving the original bytes via alt=media (plant images are size-capped
// by plan). Also serves Supabase-staged previews when Drive isn't ready.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  CORS_HEADERS,
  DRIVE_FILE_FIELDS,
  fetchDriveFileMedia,
  fetchDriveThumbnail,
  getDriveFileMetadata,
  readDriveEnv,
} from '../_shared/plant-drive.ts';

const BUCKET = 'plant-case-images';
const MAX_BYTES = 25 * 1024 * 1024; // Defensive cap on proxied bytes.

const previewCors = {
  ...CORS_HEADERS,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function errJson(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...previewCors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: previewCors });

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return errJson(401, { error: 'unauthorized' });
    const userId = userData.user.id;

    const url = new URL(req.url);
    let imageId = url.searchParams.get('plantCaseImageId') || '';
    if (!imageId && req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      imageId = String(body?.plantCaseImageId || '');
    }
    if (!imageId) return errJson(400, { error: 'invalid_input' });

    const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });
    const { data: image, error: imgErr } = await admin
      .from('plant_case_images')
      .select('*, plant_cases!inner(id,user_id)')
      .eq('id', imageId)
      .maybeSingle();
    if (imgErr || !image) return errJson(404, { error: 'not_found' });
    if ((image as any).user_id !== userId || (image as any).plant_cases.user_id !== userId) {
      return errJson(403, { error: 'forbidden' });
    }

    const cacheHeaders = {
      ...previewCors,
      'Cache-Control': 'private, max-age=300',
    };

    // 1) Google Drive path.
    if ((image as any).storage_mode === 'google_drive' && (image as any).drive_file_id) {
      const { env } = readDriveEnv();
      if (!env) return errJson(503, { error: 'drive_not_configured' });

      const fileId = String((image as any).drive_file_id);
      let thumbLink: string | null = (image as any).drive_thumbnail_link;

      const streamFrom = async (resp: Response, fallbackMime: string) => {
        if (!resp.ok) return null;
        const buf = new Uint8Array(await resp.arrayBuffer());
        if (buf.byteLength > MAX_BYTES) {
          return new Response(JSON.stringify({ error: 'too_large' }), {
            status: 413,
            headers: { ...previewCors, 'Content-Type': 'application/json' },
          });
        }
        return new Response(buf, {
          status: 200,
          headers: {
            ...cacheHeaders,
            'Content-Type':
              resp.headers.get('Content-Type') ||
              (image as any).drive_mime_type ||
              fallbackMime,
          },
        });
      };

      // Try existing thumbnailLink.
      if (thumbLink) {
        const tResp = await fetchDriveThumbnail(env, thumbLink).catch(() => null);
        if (tResp && tResp.ok) {
          const out = await streamFrom(tResp, 'image/jpeg');
          if (out) return out;
        }
      }

      // Refresh metadata; thumbnailLink may have rotated.
      const meta = await getDriveFileMetadata(env, fileId);
      if (meta) {
        const m = meta as any;
        const mm = m.imageMediaMetadata || {};
        await admin
          .from('plant_case_images')
          .update({
            drive_thumbnail_link: m.thumbnailLink ?? null,
            drive_thumbnail_version: m.thumbnailVersion ?? null,
            drive_has_thumbnail: typeof m.hasThumbnail === 'boolean' ? m.hasThumbnail : null,
            drive_web_content_link: m.webContentLink ?? null,
            drive_image_width: typeof mm.width === 'number' ? mm.width : null,
            drive_image_height: typeof mm.height === 'number' ? mm.height : null,
          })
          .eq('id', imageId);

        if (m.thumbnailLink && m.thumbnailLink !== thumbLink) {
          const tResp2 = await fetchDriveThumbnail(env, m.thumbnailLink).catch(() => null);
          if (tResp2 && tResp2.ok) {
            const out = await streamFrom(tResp2, 'image/jpeg');
            if (out) return out;
          }
        }
      }

      // Fallback: original bytes via alt=media (plan-capped in size).
      const mediaResp = await fetchDriveFileMedia(env, fileId).catch(() => null);
      if (mediaResp && mediaResp.ok) {
        const out = await streamFrom(mediaResp, (image as any).mime_type || 'image/jpeg');
        if (out) return out;
      }
      return errJson(404, { error: 'preview_unavailable' });
    }

    // 2) Supabase staging fallback.
    const path = (image as any).staging_storage_path || (image as any).storage_path;
    if (path) {
      const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(path);
      if (dlErr || !blob) return errJson(404, { error: 'preview_unavailable' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return new Response(bytes, {
        status: 200,
        headers: {
          ...cacheHeaders,
          'Content-Type': (image as any).mime_type || blob.type || 'image/jpeg',
        },
      });
    }

    return errJson(404, { error: 'preview_unavailable' });
  } catch (e) {
    console.error('[plant-image-drive-preview] fatal', (e as Error).message);
    return errJson(500, { error: 'internal_error' });
  }
});

// Silence unused import warning if DRIVE_FILE_FIELDS gets tree-shaken checks.
void DRIVE_FILE_FIELDS;
