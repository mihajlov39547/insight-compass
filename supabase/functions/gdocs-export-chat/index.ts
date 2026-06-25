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

function sanitizeUpstream(text?: string): string | undefined {
  if (!text) return undefined;
  const cleaned = text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|authorization|x-connection-api-key)\s*[:=]\s*[^\s,"}]+/gi, '$1: [redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 800 ? cleaned.slice(0, 800) + '…' : cleaned;
}

function mapUpstreamError(
  status: number,
  scope: 'create' | 'update',
  upstreamText?: string,
): Response {
  const detail = sanitizeUpstream(upstreamText);
  if (status === 401) {
    return json(
      { error: 'google_docs_not_connected', message: 'Google Docs is not connected for this project.', detail },
      400,
    );
  }
  if (status === 403) {
    return json(
      {
        error: 'google_docs_write_scope_missing',
        message:
          'Google Docs write access is not connected. Reconnect Google Docs with document create/edit scope.',
        detail,
      },
      403,
    );
  }
  if (status === 413) {
    return json(
      { error: 'file_too_large', message: 'This chat is too large to create as a Google Doc.', detail },
      413,
    );
  }
  if (status === 400) {
    if (scope === 'update') {
      return json(
        {
          error: 'google_docs_rejected_update',
          message: 'Google Docs rejected the update request.',
          detail,
        },
        400,
      );
    }
    return json(
      { error: 'invalid_input', message: `Google Docs rejected the ${scope} request.`, detail },
      400,
    );
  }
  return json(
    { error: 'create_failed', message: `Google Docs ${scope} failed (${status}).`, detail },
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
      return mapUpstreamError(createResp.status, 'create', text);
    }
    const created = await createResp.json();
    const documentId = created?.documentId as string | undefined;
    if (!documentId) {
      return json({ error: 'create_failed', message: 'Google Docs did not return a document id.' }, 502);
    }

    // 2) Insert transcript using reverse-chunk-at-index-1 strategy.
    // Each insertText at index 1 pushes existing content forward, so inserting
    // chunks in reverse order yields the correct final order without needing
    // to track cursor positions (which is fragile with Unicode / Docs indexing).
    const chunks: string[] = [];
    for (let i = 0; i < transcript.length; i += INSERT_CHUNK) {
      chunks.push(transcript.slice(i, i + INSERT_CHUNK));
    }
    const reversed = [...chunks].reverse();
    for (const chunk of reversed) {
      const requests = [
        { insertText: { location: { index: 1 }, text: chunk } },
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
        return mapUpstreamError(updResp.status, 'update', text);
      }
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
