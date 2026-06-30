// Best-effort delete of a plant image from Google Drive. Called from the
// frontend deletion hook after the DB row is removed so credentials never
// leave the backend.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CORS_HEADERS, deleteDriveFile, jsonResponse, readDriveEnv } from '../_shared/plant-drive.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const fileIds = Array.isArray(body?.driveFileIds)
      ? body.driveFileIds.filter((x: unknown) => typeof x === 'string' && x)
      : [];
    if (fileIds.length === 0) return jsonResponse({ ok: true, deleted: 0 });

    const { env, error } = readDriveEnv();
    if (!env) return jsonResponse({ ok: false, reason: error, deleted: 0 });

    let deleted = 0;
    for (const id of fileIds.slice(0, 200)) {
      try {
        const ok = await deleteDriveFile(env, id);
        if (ok) deleted++;
      } catch (e) {
        console.warn('[plant-image-drive-delete] failed for', id, (e as Error).message);
      }
    }
    return jsonResponse({ ok: true, deleted });
  } catch (e) {
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
