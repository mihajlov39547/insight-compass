// Create a native Google Doc from a chat export.
// Server-only connector calls. Does NOT re-index the created doc.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DOCS_GATEWAY = 'https://connector-gateway.lovable.dev/google_docs/v1';
const DRIVE_GATEWAY = 'https://connector-gateway.lovable.dev/google_drive/drive/v3';

const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024; // 2 MB
const INSERT_CHUNK = 60_000; // chars per batchUpdate insert

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sanitizeTitle(s: string): string {
  return (s || 'Researcher chat export')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || 'Researcher chat export';
}

async function gdocsFetch(
  path: string,
  init: RequestInit,
  lovableKey: string,
  docsKey: string,
): Promise<Response> {
  return fetch(`${DOCS_GATEWAY}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': docsKey,
    },
  });
}

function mapUpstreamError(status: number, scope: 'create' | 'update'): Response {
  if (status === 401) {
    return json(
      { error: 'google_docs_not_connected', message: 'Google Docs is not connected for this project.' },
      400,
    );
  }
  if (status === 403) {
    return json(
      {
        error: 'google_docs_write_scope_missing',
        message:
          'Google Docs write access is not connected. Reconnect Google Docs with document create/edit scope.',
      },
      403,
    );
  }
  if (status === 413) {
    return json(
      { error: 'file_too_large', message: 'This chat is too large to create as a Google Doc.' },
      413,
    );
  }
  if (status === 400) {
    return json(
      { error: 'invalid_input', message: `Google Docs rejected the ${scope} request.` },
      400,
    );
  }
  return json(
    { error: 'create_failed', message: `Google Docs ${scope} failed (${status}).` },
    502,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    const docsKey = Deno.env.get('GOOGLE_DOCS_API_KEY');
    const driveKey = Deno.env.get('GOOGLE_DRIVE_API_KEY'); // optional, for webViewLink fallback
    if (!lovableKey || !docsKey) {
      return json(
        { error: 'google_docs_not_connected', message: 'Google Docs is not connected for this project.' },
        400,
      );
    }

    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    const userClient = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const contextType = body?.contextType as 'project' | 'notebook';
    const contextId = body?.contextId ? String(body.contextId) : null;
    const chatId = body?.chatId ? String(body.chatId) : null;
    const rawTitle = String(body?.title || '');
    const transcript = typeof body?.transcript === 'string' ? body.transcript : '';

    if (
      !contextId ||
      (contextType !== 'project' && contextType !== 'notebook') ||
      !rawTitle ||
      !transcript
    ) {
      return json(
        { error: 'invalid_input', message: 'Missing or invalid export parameters.' },
        400,
      );
    }

    const transcriptBytes = new TextEncoder().encode(transcript).byteLength;
    if (transcriptBytes > MAX_TRANSCRIPT_BYTES) {
      return json(
        {
          error: 'file_too_large',
          message:
            'This chat is too large to create as a Google Doc. Try Markdown or PDF export.',
        },
        413,
      );
    }

    const { data: hasPerm, error: permErr } = await userClient.rpc('check_item_permission', {
      p_user_id: userId,
      p_item_id: contextId,
      p_item_type: contextType,
      p_min_role: 'viewer',
    });
    if (permErr || !hasPerm) {
      return json(
        { error: 'forbidden', message: 'You do not have access to this chat.' },
        403,
      );
    }

    const title = sanitizeTitle(rawTitle);

    // 1) Create document.
    const createResp = await gdocsFetch(
      '/documents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      },
      lovableKey,
      docsKey,
    );
    if (!createResp.ok) {
      const text = await createResp.text().catch(() => '');
      console.error('[gdocs-export-chat] create fail', createResp.status, text);
      return mapUpstreamError(createResp.status, 'create');
    }
    const created = await createResp.json();
    const documentId = created?.documentId as string | undefined;
    if (!documentId) {
      return json({ error: 'create_failed', message: 'Google Docs did not return a document id.' }, 502);
    }

    // 2) Insert transcript in chunks. New empty doc: index 1, then append at end.
    // Each subsequent insert: location = current_length + 1. We insert in order at
    // a moving cursor; using endOfSegmentLocation simplifies append semantics.
    const chunks: string[] = [];
    for (let i = 0; i < transcript.length; i += INSERT_CHUNK) {
      chunks.push(transcript.slice(i, i + INSERT_CHUNK));
    }

    // First insert must use explicit index (endOfSegmentLocation is invalid for empty bodies on some configs).
    // Strategy: insert sequentially with location index = running length + 1.
    let cursor = 1;
    for (const chunk of chunks) {
      const requests = [
        { insertText: { location: { index: cursor }, text: chunk } },
      ];
      const updResp = await gdocsFetch(
        `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        },
        lovableKey,
        docsKey,
      );
      if (!updResp.ok) {
        const text = await updResp.text().catch(() => '');
        console.error('[gdocs-export-chat] batchUpdate fail', updResp.status, text);
        return mapUpstreamError(updResp.status, 'update');
      }
      cursor += chunk.length;
    }

    // 3) Build webViewLink. Prefer Drive metadata if available, otherwise construct.
    let webViewLink: string | null = `https://docs.google.com/document/d/${documentId}/edit`;
    if (driveKey) {
      try {
        const metaUrl = new URL(`${DRIVE_GATEWAY}/files/${encodeURIComponent(documentId)}`);
        metaUrl.searchParams.set('fields', 'id,webViewLink');
        const metaResp = await fetch(metaUrl.toString(), {
          headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': driveKey },
        });
        if (metaResp.ok) {
          const meta = await metaResp.json();
          if (meta?.webViewLink) webViewLink = meta.webViewLink;
        }
      } catch (err) {
        console.warn('[gdocs-export-chat] webViewLink lookup failed', err);
      }
    }

    return json({
      documentId,
      title,
      webViewLink,
      contextType,
      contextId,
      chatId,
    });
  } catch (err: any) {
    console.error('[gdocs-export-chat] unexpected', err);
    return json(
      { error: 'internal_error', message: err?.message || 'Unknown error' },
      500,
    );
  }
});
