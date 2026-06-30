// Re-runs Google Drive upload for a staged or failed plant image by delegating
// to the same logic used by plant-image-drive-upload.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CORS_HEADERS, jsonResponse } from '../_shared/plant-drive.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const imageId = String(body?.plantCaseImageId || '');
    if (!imageId) return jsonResponse({ error: 'invalid_input' }, 400);

    // Reset the row to a retry-able state, then call the upload function.
    const { error: resetErr } = await userClient
      .from('plant_case_images')
      .update({ upload_status: 'staged', upload_error_code: null, upload_error_message: null })
      .eq('id', imageId);
    if (resetErr) return jsonResponse({ error: 'reset_failed', message: resetErr.message }, 500);

    const fnUrl = `${supaUrl}/functions/v1/plant-image-drive-upload`;
    const resp = await fetch(fnUrl, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plantCaseImageId: imageId }),
    });
    const data = await resp.json().catch(() => ({}));
    return jsonResponse(data, resp.status);
  } catch (e) {
    console.error('[plant-image-drive-retry] fatal', (e as Error).message);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
