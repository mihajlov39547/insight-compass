// Deletes a plant image (or a whole plant case) and its Google Drive copies.
// Ownership is enforced by reading and deleting the rows with the caller's own
// session (RLS); Drive file IDs are taken only from rows the caller could
// delete — never from the request body.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CORS_HEADERS, deleteDriveFile, jsonResponse, readDriveEnv } from '../_shared/plant-drive.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const user = userData?.user;
    if (!user) return jsonResponse({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const imageId = typeof body?.imageId === 'string' && UUID.test(body.imageId) ? body.imageId : null;
    const caseId = typeof body?.caseId === 'string' && UUID.test(body.caseId) ? body.caseId : null;
    if (!imageId && !caseId) return jsonResponse({ error: 'invalid_request' }, 400);

    let driveIds: string[] = [];
    if (caseId) {
      const { data: c } = await userClient.from('plant_cases').select('id, user_id').eq('id', caseId).maybeSingle();
      if (!c || c.user_id !== user.id) return jsonResponse({ error: 'not_found' }, 404);
      const { data: imgs } = await userClient
        .from('plant_case_images').select('drive_file_id').eq('case_id', caseId);
      driveIds = (imgs ?? []).map((r: any) => r.drive_file_id).filter(Boolean);
      const { error } = await userClient.from('plant_cases').delete().eq('id', caseId).eq('user_id', user.id);
      if (error) return jsonResponse({ error: 'delete_failed' }, 400);
    } else {
      const { data: img } = await userClient
        .from('plant_case_images').select('id, user_id, drive_file_id').eq('id', imageId).maybeSingle();
      if (!img || img.user_id !== user.id) return jsonResponse({ error: 'not_found' }, 404);
      const { data: deleted, error } = await userClient
        .from('plant_case_images').delete().eq('id', imageId).eq('user_id', user.id).select('id');
      if (error || !deleted?.length) return jsonResponse({ error: 'delete_failed' }, 400);
      if (img.drive_file_id) driveIds = [img.drive_file_id];
    }

    if (driveIds.length === 0) return jsonResponse({ ok: true, deleted: 0 });
    const { env, error } = readDriveEnv();
    if (!env) return jsonResponse({ ok: true, driveSkipped: error, deleted: 0 });

    let deleted = 0;
    for (const id of driveIds.slice(0, 500)) {
      try {
        if (await deleteDriveFile(env, id)) deleted++;
      } catch (e) {
        console.warn('[plant-image-drive-delete] drive delete failed', (e as Error).message);
      }
    }
    return jsonResponse({ ok: true, deleted });
  } catch (_e) {
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
