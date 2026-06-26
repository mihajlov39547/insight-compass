// Create a native Google Doc from a chat export.
// Server-only connector calls. Does NOT re-index the created doc.
//
// Strategy:
//   1) Create the document.
//   2) Insert the full plain text using reverse-chunk-at-index-1 (avoids
//      fragile cursor math, works with Unicode).
//   3) Apply paragraph/text/bullet styling in a separate batchUpdate.
//      Styling failures DO NOT fail the export — we return the document
//      with `warning: "formatting_partial"` so the user keeps a usable Doc.
//
// Backward compatible: if the client sends only `transcript` (no `docModel`),
// we fall back to the previous raw-Markdown insert behavior.

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
const STYLE_REQUEST_BATCH = 200; // styling requests per batchUpdate call

type NamedStyle =
  | 'TITLE'
  | 'HEADING_1'
  | 'HEADING_2'
  | 'HEADING_3'
  | 'NORMAL_TEXT';

interface TextRange {
  start: number;
  end: number;
  kind: 'bold' | 'italic' | 'code' | 'link' | 'muted';
  url?: string;
}
interface ParaRange {
  start: number;
  end: number;
  namedStyleType: NamedStyle;
}
interface BulletRange {
  start: number;
  end: number;
}
interface DocModel {
  version: number;
  plainText: string;
  textStyles: TextRange[];
  paragraphStyles: ParaRange[];
  bullets: BulletRange[];
}

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

// ---- styling -----------------------------------------------------------

/**
 * Translate a DocModel into Google Docs batchUpdate requests.
 * Offsets in DocModel are zero-based; Google Docs body starts at index 1.
 * We shift every range by +1.
 *
 * Clamp ranges defensively to [1, plainTextLen + 1) so a malformed range
 * cannot poison the whole styling batch.
 */
function buildStyleRequests(model: DocModel): Record<string, unknown>[] {
  const len = model.plainText.length;
  const docEnd = len + 1; // Docs end-of-body index after insert.
  const clamp = (n: number) => Math.max(1, Math.min(docEnd, n + 1));

  const requests: Record<string, unknown>[] = [];

  // Paragraph styles (headings, title).
  for (const p of model.paragraphStyles || []) {
    const startIndex = clamp(p.start);
    const endIndex = clamp(p.end);
    if (endIndex <= startIndex) continue;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex, endIndex },
        paragraphStyle: { namedStyleType: p.namedStyleType },
        fields: 'namedStyleType',
      },
    });
  }

  // Bullets.
  for (const b of model.bullets || []) {
    const startIndex = clamp(b.start);
    const endIndex = clamp(b.end);
    if (endIndex <= startIndex) continue;
    requests.push({
      createParagraphBullets: {
        range: { startIndex, endIndex },
        bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
      },
    });
  }

  // Text styles.
  for (const t of model.textStyles || []) {
    const startIndex = clamp(t.start);
    const endIndex = clamp(t.end);
    if (endIndex <= startIndex) continue;
    const range = { startIndex, endIndex };
    switch (t.kind) {
      case 'bold':
        requests.push({
          updateTextStyle: {
            range,
            textStyle: { bold: true },
            fields: 'bold',
          },
        });
        break;
      case 'italic':
        requests.push({
          updateTextStyle: {
            range,
            textStyle: { italic: true },
            fields: 'italic',
          },
        });
        break;
      case 'code':
        requests.push({
          updateTextStyle: {
            range,
            textStyle: {
              backgroundColor: {
                color: { rgbColor: { red: 0.95, green: 0.96, blue: 0.97 } },
              },
            },
            fields: 'backgroundColor',
          },
        });
        break;
      case 'muted':
        requests.push({
          updateTextStyle: {
            range,
            textStyle: {
              foregroundColor: {
                color: { rgbColor: { red: 0.45, green: 0.5, blue: 0.55 } },
              },
            },
            fields: 'foregroundColor',
          },
        });
        break;
      case 'link': {
        if (!t.url || !/^(https?:|mailto:)/i.test(t.url)) break;
        requests.push({
          updateTextStyle: {
            range,
            textStyle: { link: { url: t.url } },
            fields: 'link',
          },
        });
        break;
      }
    }
  }

  return requests;
}

async function insertReversedChunks(
  documentId: string,
  text: string,
  lovableKey: string,
  docsKey: string,
): Promise<Response | null> {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += INSERT_CHUNK) {
    chunks.push(text.slice(i, i + INSERT_CHUNK));
  }
  const reversed = [...chunks].reverse();
  for (const chunk of reversed) {
    const requests = [{ insertText: { location: { index: 1 }, text: chunk } }];
    const resp = await gdocsFetch(
      `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      },
      lovableKey,
      docsKey,
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[gdocs-export-chat] insertText fail', resp.status, body);
      return mapUpstreamError(resp.status, 'update', body);
    }
  }
  return null;
}

async function applyStyleRequests(
  documentId: string,
  requests: Record<string, unknown>[],
  lovableKey: string,
  docsKey: string,
): Promise<{ ok: true } | { ok: false; status: number; detail?: string }> {
  for (let i = 0; i < requests.length; i += STYLE_REQUEST_BATCH) {
    const batch = requests.slice(i, i + STYLE_REQUEST_BATCH);
    const resp = await gdocsFetch(
      `/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: batch }),
      },
      lovableKey,
      docsKey,
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, detail: sanitizeUpstream(body) };
    }
  }
  return { ok: true };
}

// ---- handler ----------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    const docsKey = Deno.env.get('GOOGLE_DOCS_API_KEY');
    const driveKey = Deno.env.get('GOOGLE_DRIVE_API_KEY');
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
    const docModel = (body?.docModel ?? null) as DocModel | null;

    // Choose payload: prefer structured docModel, otherwise fall back to transcript.
    const usingModel =
      !!docModel &&
      typeof docModel === 'object' &&
      typeof docModel.plainText === 'string' &&
      docModel.plainText.length > 0;
    const textPayload = usingModel ? docModel!.plainText : transcript;

    if (
      !contextId ||
      (contextType !== 'project' && contextType !== 'notebook') ||
      !rawTitle ||
      !textPayload
    ) {
      return json(
        { error: 'invalid_input', message: 'Missing or invalid export parameters.' },
        400,
      );
    }

    const transcriptBytes = new TextEncoder().encode(textPayload).byteLength;
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

    // 2) Insert text using reverse-chunk-at-index-1 strategy.
    const insertErr = await insertReversedChunks(documentId, textPayload, lovableKey, docsKey);
    if (insertErr) return insertErr;

    // 3) Apply styling if we have a structured model. Failures are non-fatal.
    let warning: 'formatting_partial' | undefined;
    if (usingModel) {
      const requests = buildStyleRequests(docModel!);
      if (requests.length > 0) {
        const styleResult = await applyStyleRequests(documentId, requests, lovableKey, docsKey);
        if (!styleResult.ok) {
          warning = 'formatting_partial';
          console.warn(
            '[gdocs-export-chat] styling partial',
            styleResult.status,
            styleResult.detail,
          );
        }
      }
    }

    // 4) Build webViewLink.
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
      ...(warning ? { warning } : {}),
    });
  } catch (err: any) {
    console.error('[gdocs-export-chat] unexpected', err);
    return json(
      { error: 'internal_error', message: err?.message || 'Unknown error' },
      500,
    );
  }
});
