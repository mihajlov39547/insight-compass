// Ingest a Google Drive file as a document, reusing the existing
// document_processing_v1 workflow. Read-only on Drive: never mutates files.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GATEWAY = 'https://connector-gateway.lovable.dev/google_drive/drive/v3';
const MAX_BYTES_BINARY = 25 * 1024 * 1024; // 25 MB for binary downloads
const MAX_BYTES_EXPORT = 10 * 1024 * 1024; // 10 MB Drive export cap

interface IngestPlan {
  ext: string;
  fileType: string; // documents.file_type
  storedMime: string;
  exportMime?: string; // present when we must export (Workspace docs)
  exportFallbackMime?: string; // fallback export mime if primary fails
}

function planForMime(mimeType: string): IngestPlan | null {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
      return {
        ext: 'md',
        fileType: 'md',
        storedMime: 'text/markdown',
        exportMime: 'text/markdown',
        exportFallbackMime: 'text/plain',
      };
    case 'application/pdf':
      return { ext: 'pdf', fileType: 'pdf', storedMime: 'application/pdf' };
    case 'text/plain':
      return { ext: 'txt', fileType: 'txt', storedMime: 'text/plain' };
    case 'text/markdown':
      return { ext: 'md', fileType: 'md', storedMime: 'text/markdown' };
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return {
        ext: 'docx',
        fileType: 'docx',
        storedMime:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    default:
      return null;
  }
}

function planFromExportMime(exportMime: string): { ext: string; fileType: string; storedMime: string } {
  if (exportMime === 'text/markdown') return { ext: 'md', fileType: 'md', storedMime: 'text/markdown' };
  return { ext: 'txt', fileType: 'txt', storedMime: 'text/plain' };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    const driveKey = Deno.env.get('GOOGLE_DRIVE_API_KEY');
    if (!lovableKey || !driveKey) {
      return jsonResponse(
        { error: 'google_drive_not_connected', message: 'Google Drive connector is not linked to this project.' },
        400,
      );
    }

    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supaService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const fileId = String(body.fileId || '').trim();
    const containerType = body.containerType as 'project' | 'notebook';
    const containerId = body.containerId ? String(body.containerId) : null;

    if (!fileId || !containerId || (containerType !== 'project' && containerType !== 'notebook')) {
      return jsonResponse({ error: 'invalid_input', message: 'fileId, containerType and containerId are required.' }, 400);
    }

    // Permission check: editor on the target container.
    const { data: hasPerm, error: permErr } = await userClient.rpc('check_item_permission', {
      p_user_id: userId,
      p_item_id: containerId,
      p_item_type: containerType,
      p_min_role: 'editor',
    });
    if (permErr || !hasPerm) {
      return jsonResponse({ error: 'forbidden', message: 'You do not have edit access to this workspace.' }, 403);
    }

    // 1) Metadata
    const metaUrl = new URL(`${GATEWAY}/files/${encodeURIComponent(fileId)}`);
    metaUrl.searchParams.set(
      'fields',
      'id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName,emailAddress),parents,capabilities(canDownload)',
    );
    const metaResp = await fetch(metaUrl.toString(), {
      headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': driveKey },
    });
    if (!metaResp.ok) {
      const text = await metaResp.text().catch(() => '');
      console.error('[gdrive-ingest] metadata fail', metaResp.status, text);
      if (metaResp.status === 404) return jsonResponse({ error: 'file_not_found', message: 'File not found in Drive.' }, 404);
      if (metaResp.status === 401 || metaResp.status === 403) {
        return jsonResponse({ error: 'google_drive_permission_denied', message: 'Google Drive access denied.' }, metaResp.status);
      }
      return jsonResponse({ error: 'metadata_failed', message: `Drive metadata failed (${metaResp.status}).` }, 502);
    }
    const meta = await metaResp.json();
    const plan = planForMime(meta.mimeType);
    if (!plan) {
      return jsonResponse(
        { error: 'unsupported_type', message: `This file type is not supported yet: ${meta.mimeType}` },
        415,
      );
    }
    if (meta.capabilities && meta.capabilities.canDownload === false) {
      return jsonResponse(
        { error: 'not_downloadable', message: 'The owner has disabled downloading for this file.' },
        403,
      );
    }
    const isExport = !!plan.exportMime;
    const sizeCap = isExport ? MAX_BYTES_EXPORT : MAX_BYTES_BINARY;
    if (!isExport && meta.size && Number(meta.size) > sizeCap) {
      return jsonResponse(
        { error: 'file_too_large', message: 'This file exceeds the 25 MB limit for now.' },
        413,
      );
    }

    // 2) Fetch content (with markdown→plain fallback for Google Docs)
    async function fetchExport(mime: string): Promise<Response> {
      const u = new URL(`${GATEWAY}/files/${encodeURIComponent(fileId)}/export`);
      u.searchParams.set('mimeType', mime);
      return fetch(u.toString(), {
        headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': driveKey },
      });
    }

    let contentResp: Response;
    let effectiveExportMime: string | undefined;
    if (isExport) {
      effectiveExportMime = plan.exportMime!;
      contentResp = await fetchExport(effectiveExportMime);
      if (!contentResp.ok && plan.exportFallbackMime) {
        const t = await contentResp.text().catch(() => '');
        console.warn('[gdrive-ingest] primary export failed, falling back', contentResp.status, t);
        effectiveExportMime = plan.exportFallbackMime;
        contentResp = await fetchExport(effectiveExportMime);
      }
    } else {
      const u = new URL(`${GATEWAY}/files/${encodeURIComponent(fileId)}`);
      u.searchParams.set('alt', 'media');
      contentResp = await fetch(u.toString(), {
        headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': driveKey },
      });
    }
    if (!contentResp.ok) {
      const text = await contentResp.text().catch(() => '');
      console.error('[gdrive-ingest] content fail', contentResp.status, text);
      // Drive returns 403 with "exportSizeLimitExceeded" for >10MB Docs exports.
      if (isExport && /exportSizeLimitExceeded/i.test(text)) {
        return jsonResponse(
          { error: 'export_too_large', message: 'This Google Doc is too large to export (Drive limits exports to 10 MB).' },
          413,
        );
      }
      return jsonResponse({ error: 'content_failed', message: `Could not read file content (${contentResp.status}).` }, 502);
    }
    const bytes = new Uint8Array(await contentResp.arrayBuffer());
    if (bytes.byteLength > sizeCap) {
      return jsonResponse(
        {
          error: isExport ? 'export_too_large' : 'file_too_large',
          message: isExport
            ? 'This Google Doc is too large to export (Drive limits exports to 10 MB).'
            : 'This file exceeds the 25 MB limit for now.',
        },
        413,
      );
    }

    // Recompute extension/mime if we exported (and possibly fell back)
    const effectivePlan = isExport
      ? { ...plan, ...planFromExportMime(effectiveExportMime!) }
      : plan;

    // 3) Upload to Storage as service role.
    const admin = createClient(supaUrl, supaService, { auth: { persistSession: false } });
    const projectIdForPath = containerType === 'project' ? containerId : 'notebooks';
    const newDocId = crypto.randomUUID();
    const storagePath = `${userId}/${projectIdForPath}/${newDocId}.${effectivePlan.ext}`;
    const safeName = (meta.name || 'untitled').replace(/[/\\\\]+/g, '_');
    const fileName = safeName.toLowerCase().endsWith(`.${effectivePlan.ext}`)
      ? safeName
      : `${safeName}.${effectivePlan.ext}`;

    const { error: storageErr } = await admin.storage
      .from('insight-navigator')
      .upload(storagePath, bytes, { contentType: effectivePlan.storedMime, upsert: false });
    if (storageErr) {
      console.error('[gdrive-ingest] storage upload failed', storageErr.message);
      return jsonResponse({ error: 'storage_failed', message: storageErr.message }, 500);
    }


    // 4) Insert document row.
    const insertRow: Record<string, unknown> = {
      id: newDocId,
      user_id: userId,
      project_id: containerType === 'project' ? containerId : null,
      notebook_id: containerType === 'notebook' ? containerId : null,
      chat_id: null,
      file_name: fileName,
      file_type: plan.fileType,
      mime_type: plan.storedMime,
      file_size: bytes.byteLength,
      storage_path: storagePath,
      processing_status: 'uploaded',
      provider: 'google_drive',
      external_id: meta.id,
      external_url: meta.webViewLink || null,
      external_modified_at: meta.modifiedTime || null,
      external_metadata: {
        original_mime_type: meta.mimeType,
        owner: meta.owners?.[0]?.displayName || meta.owners?.[0]?.emailAddress || null,
        parents: meta.parents || [],
      },
    };

    const { data: inserted, error: insertErr } = await admin
      .from('documents')
      .insert(insertRow)
      .select('id, user_id, storage_path, processing_status')
      .single();

    if (insertErr) {
      // Cleanup uploaded blob to avoid orphans (e.g. unique-index conflict).
      await admin.storage.from('insight-navigator').remove([storagePath]).catch(() => {});
      console.error('[gdrive-ingest] insert failed', insertErr);
      const isDupe = /duplicate key|unique/i.test(insertErr.message || '');
      return jsonResponse(
        {
          error: isDupe ? 'already_added' : 'insert_failed',
          message: isDupe
            ? 'This Drive file has already been added to this workspace.'
            : insertErr.message,
        },
        isDupe ? 409 : 500,
      );
    }

    // 5) Kick the existing document processing workflow.
    try {
      const wfResp = await fetch(`${supaUrl}/functions/v1/workflow-start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supaService}`,
        },
        body: JSON.stringify({
          definition_key: 'document_processing_v1',
          input_payload: {
            document_id: inserted.id,
            source: 'upload',
            source_document_id: inserted.id,
            source_storage_path: inserted.storage_path,
            initiated_at: new Date().toISOString(),
          },
          user_id: userId,
          trigger_entity_type: 'document',
          trigger_entity_id: inserted.id,
          idempotency_key: `upload-workflow-${inserted.id}`,
          create_initial_context_snapshot: true,
        }),
      });
      if (!wfResp.ok) {
        const t = await wfResp.text().catch(() => '');
        console.warn('[gdrive-ingest] workflow-start failed', wfResp.status, t);
      }
    } catch (err) {
      console.warn('[gdrive-ingest] workflow-start error', err);
    }

    return jsonResponse({
      documentId: inserted.id,
      title: fileName,
      status: 'queued',
    });
  } catch (err: any) {
    console.error('[gdrive-ingest] unexpected', err);
    return jsonResponse({ error: 'internal_error', message: err?.message || 'Unknown error' }, 500);
  }
});
