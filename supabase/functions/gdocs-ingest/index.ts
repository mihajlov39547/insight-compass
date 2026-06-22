// Ingest a single Google Doc as a document, exported via Drive's export
// endpoint. provider = 'google_docs'. Reuses document_processing_v1 workflow.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GATEWAY = 'https://connector-gateway.lovable.dev/google_drive/drive/v3';
const DOC_MIME = 'application/vnd.google-apps.document';
const MAX_BYTES_EXPORT = 10 * 1024 * 1024; // 10 MB Drive export cap

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
        { error: 'google_docs_not_connected', message: 'Google Docs connector is not linked to this project.' },
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

    // Permission: editor on container.
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
      'id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress),parents,capabilities(canDownload)',
    );
    const metaResp = await fetch(metaUrl.toString(), {
      headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': driveKey },
    });
    if (!metaResp.ok) {
      const text = await metaResp.text().catch(() => '');
      console.error('[gdocs-ingest] metadata fail', metaResp.status, text);
      if (metaResp.status === 404) return jsonResponse({ error: 'file_not_found', message: 'Google Doc not found.' }, 404);
      if (metaResp.status === 401 || metaResp.status === 403) {
        return jsonResponse({ error: 'google_docs_permission_denied', message: 'Google Docs access denied.' }, metaResp.status);
      }
      return jsonResponse({ error: 'metadata_failed', message: `Metadata request failed (${metaResp.status}).` }, 502);
    }
    const meta = await metaResp.json();

    if (meta.mimeType !== DOC_MIME) {
      return jsonResponse(
        { error: 'not_a_google_doc', message: 'This file is not a Google Doc.' },
        415,
      );
    }
    if (meta.capabilities && meta.capabilities.canDownload === false) {
      return jsonResponse(
        { error: 'not_downloadable', message: 'This document cannot be exported with the current permissions.' },
        403,
      );
    }

    // 2) Export: prefer markdown, fall back to plain text.
    async function fetchExport(mime: string): Promise<Response> {
      const u = new URL(`${GATEWAY}/files/${encodeURIComponent(fileId)}/export`);
      u.searchParams.set('mimeType', mime);
      return fetch(u.toString(), {
        headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': driveKey },
      });
    }

    let effectiveExportMime = 'text/markdown';
    let contentResp = await fetchExport(effectiveExportMime);
    if (!contentResp.ok) {
      const t = await contentResp.text().catch(() => '');
      console.warn('[gdocs-ingest] markdown export failed, falling back to plain', contentResp.status, t);
      effectiveExportMime = 'text/plain';
      contentResp = await fetchExport(effectiveExportMime);
    }
    if (!contentResp.ok) {
      const text = await contentResp.text().catch(() => '');
      console.error('[gdocs-ingest] export failed', contentResp.status, text);
      if (/exportSizeLimitExceeded/i.test(text)) {
        return jsonResponse(
          { error: 'export_too_large', message: 'This Google Doc is too large to export (Drive limits exports to 10 MB).' },
          413,
        );
      }
      return jsonResponse({ error: 'export_failed', message: `Could not export this Google Doc (${contentResp.status}).` }, 502);
    }
    const bytes = new Uint8Array(await contentResp.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES_EXPORT) {
      return jsonResponse(
        { error: 'export_too_large', message: 'This Google Doc is too large to export (Drive limits exports to 10 MB).' },
        413,
      );
    }

    const ext = effectiveExportMime === 'text/markdown' ? 'md' : 'txt';
    const fileType = ext;
    const storedMime = effectiveExportMime;

    // 3) Upload to Storage as service role.
    const admin = createClient(supaUrl, supaService, { auth: { persistSession: false } });
    const projectIdForPath = containerType === 'project' ? containerId : 'notebooks';
    const newDocId = crypto.randomUUID();
    const storagePath = `${userId}/${projectIdForPath}/${newDocId}.${ext}`;
    const safeName = (meta.name || 'untitled').replace(/[/\\\\]+/g, '_');
    const fileName = safeName.toLowerCase().endsWith(`.${ext}`)
      ? safeName
      : `${safeName}.${ext}`;

    const { error: storageErr } = await admin.storage
      .from('insight-navigator')
      .upload(storagePath, bytes, { contentType: storedMime, upsert: false });
    if (storageErr) {
      console.error('[gdocs-ingest] storage upload failed', storageErr.message);
      return jsonResponse({ error: 'storage_failed', message: storageErr.message }, 500);
    }

    const owner0 = meta.owners?.[0];
    const insertRow: Record<string, unknown> = {
      id: newDocId,
      user_id: userId,
      project_id: containerType === 'project' ? containerId : null,
      notebook_id: containerType === 'notebook' ? containerId : null,
      chat_id: null,
      file_name: fileName,
      file_type: fileType,
      mime_type: storedMime,
      file_size: bytes.byteLength,
      storage_path: storagePath,
      processing_status: 'uploaded',
      provider: 'google_docs',
      external_id: meta.id,
      external_url: meta.webViewLink || null,
      external_modified_at: meta.modifiedTime || null,
      external_metadata: {
        sourceProvider: 'google_docs',
        googleMimeType: DOC_MIME,
        exportMimeType: effectiveExportMime,
        originalName: meta.name,
        ownerName: owner0?.displayName || null,
        ownerEmail: owner0?.emailAddress || null,
        containerType,
        containerId,
      },
    };

    const { data: inserted, error: insertErr } = await admin
      .from('documents')
      .insert(insertRow)
      .select('id, user_id, storage_path, processing_status')
      .single();

    if (insertErr) {
      await admin.storage.from('insight-navigator').remove([storagePath]).catch(() => {});
      console.error('[gdocs-ingest] insert failed', insertErr);
      const isDupe = /duplicate key|unique/i.test(insertErr.message || '');
      return jsonResponse(
        {
          error: isDupe ? 'already_added' : 'insert_failed',
          message: isDupe
            ? `This Google Doc is already added to this ${containerType}.`
            : insertErr.message,
        },
        isDupe ? 409 : 500,
      );
    }

    // 4) Kick processing workflow.
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
        console.warn('[gdocs-ingest] workflow-start failed', wfResp.status, t);
      }
    } catch (err) {
      console.warn('[gdocs-ingest] workflow-start error', err);
    }

    return jsonResponse({
      documentId: inserted.id,
      title: fileName,
      status: 'queued',
      provider: 'google_docs',
    });
  } catch (err: any) {
    console.error('[gdocs-ingest] unexpected', err);
    return jsonResponse({ error: 'internal_error', message: err?.message || 'Unknown error' }, 500);
  }
});
