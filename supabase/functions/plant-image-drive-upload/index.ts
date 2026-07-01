// Move a staged Supabase plant image to Google Drive and update the DB row.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  CORS_HEADERS,
  deleteDriveFile,
  extFromMime,
  jsonResponse,
  readDriveEnv,
  sanitizeDriveName,
  uploadBytesToDrive,
} from '../_shared/plant-drive.ts';

const BUCKET = 'plant-case-images';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const imageId = String(body?.plantCaseImageId || '');
    if (!imageId) return jsonResponse({ error: 'invalid_input' }, 400);

    const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

    const { data: image, error: imgErr } = await admin
      .from('plant_case_images')
      .select('*, plant_cases!inner(id,user_id,title)')
      .eq('id', imageId)
      .maybeSingle();
    if (imgErr || !image) return jsonResponse({ error: 'not_found' }, 404);
    if ((image as any).user_id !== userId || (image as any).plant_cases.user_id !== userId) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }

    if ((image as any).storage_mode === 'google_drive' && (image as any).drive_file_id) {
      return jsonResponse({ ok: true, alreadyOnDrive: true, image });
    }

    const { env, error: envErr } = readDriveEnv();
    if (!env) {
      await admin.from('plant_case_images').update({
        upload_status: 'drive_failed',
        upload_error_code: envErr,
        upload_error_message: 'Google Drive storage is not configured.',
      }).eq('id', imageId);
      return jsonResponse({ error: envErr, message: 'Google Drive is not configured for plant images.' }, 200);
    }

    const storagePath = (image as any).staging_storage_path || (image as any).storage_path;
    if (!storagePath) return jsonResponse({ error: 'no_staging_object' }, 400);

    // Download from Supabase storage using service role.
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(storagePath);
    if (dlErr || !blob) return jsonResponse({ error: 'download_failed', message: dlErr?.message }, 500);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    await admin.from('plant_case_images').update({ upload_status: 'uploading' }).eq('id', imageId);

    const mime = (image as any).mime_type || blob.type || 'image/jpeg';
    const ext = extFromMime(mime);
    const role = (image as any).image_role || 'auto';
    const title = ((image as any).plant_cases.title || 'plant').toString();
    const filename = sanitizeDriveName(`${title}-${role}-${imageId}.${ext}`);

    try {
      const drive = await uploadBytesToDrive({
        env,
        bytes,
        filename,
        mimeType: mime,
        appProperties: { caseId: (image as any).case_id, imageId, userId },
      });

      const keepStaging = (Deno.env.get('KEEP_PLANT_IMAGE_STAGING') || '').toLowerCase() === 'true';
      if (!keepStaging) {
        await admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      }

      const update: Record<string, unknown> = {
        storage_mode: 'google_drive',
        upload_status: 'ready',
        drive_file_id: drive.id,
        drive_web_view_link: drive.webViewLink,
        drive_web_content_link: drive.webContentLink,
        drive_folder_id: env.folderId,
        drive_mime_type: drive.mimeType,
        drive_uploaded_at: new Date().toISOString(),
        drive_thumbnail_link: drive.thumbnailLink,
        drive_thumbnail_version: drive.thumbnailVersion,
        drive_has_thumbnail: drive.hasThumbnail,
        drive_image_width: drive.imageWidth,
        drive_image_height: drive.imageHeight,
        upload_error_code: null,
        upload_error_message: null,
      };

      if (!keepStaging) update.staging_storage_path = null;

      const { data: updated } = await admin
        .from('plant_case_images')
        .update(update)
        .eq('id', imageId)
        .select('*')
        .maybeSingle();

      return jsonResponse({ ok: true, image: updated });
    } catch (e) {
      const message = (e as Error).message || 'drive_upload_failed';
      console.error('[plant-image-drive-upload] failed', message);
      await admin.from('plant_case_images').update({
        storage_mode: 'supabase',
        upload_status: 'drive_failed',
        upload_error_code: 'drive_upload_failed',
        upload_error_message: message.slice(0, 500),
      }).eq('id', imageId);
      return jsonResponse({ error: 'drive_upload_failed', message }, 200);
    }
  } catch (e) {
    console.error('[plant-image-drive-upload] fatal', (e as Error).message);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
