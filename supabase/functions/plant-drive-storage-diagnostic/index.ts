// Light diagnostic: reports whether Google Drive plant-image storage is configured
// and writable. Returns sanitized status only — no credentials or raw errors.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  CORS_HEADERS,
  DRIVE_GATEWAY_FILES,
  jsonResponse,
  readDriveEnv,
} from '../_shared/plant-drive.ts';

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
    if (!userData?.user) return jsonResponse({ configured: false, reason: 'unauthorized' }, 401);

    const { env, error } = readDriveEnv();
    if (!env) return jsonResponse({ configured: false, reason: error });

    // Cheap metadata read to confirm folder exists and is reachable.
    const url = `${DRIVE_GATEWAY_FILES}/${encodeURIComponent(env.folderId)}?fields=id,name,mimeType,trashed`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.lovableKey}`,
        'X-Connection-Api-Key': env.driveKey,
      },
    });
    if (!resp.ok) {
      return jsonResponse({ configured: false, reason: `folder_unreachable_${resp.status}` });
    }
    const meta = await resp.json();
    if (meta?.trashed) return jsonResponse({ configured: false, reason: 'folder_trashed' });
    if (meta?.mimeType !== 'application/vnd.google-apps.folder') {
      return jsonResponse({ configured: false, reason: 'not_a_folder' });
    }
    return jsonResponse({ configured: true, folderName: meta?.name ?? null });
  } catch (e) {
    return jsonResponse({ configured: false, reason: 'internal_error' }, 200);
  }
});
