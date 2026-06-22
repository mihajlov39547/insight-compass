// Search Google Docs only (mimeType = application/vnd.google-apps.document)
// via the existing Google Drive connector gateway. Read-only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_drive/drive/v3';
const DOC_MIME = 'application/vnd.google-apps.document';

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
    const authHeader = req.headers.get('Authorization') || '';
    const supabase = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    const clauses: string[] = ['trashed = false', `mimeType = '${DOC_MIME}'`];
    const q = String(body.query || '').trim().replace(/'/g, "\\'");
    if (q) clauses.push(`name contains '${q}'`);

    const url = new URL(`${GATEWAY_URL}/files`);
    url.searchParams.set('q', clauses.join(' and '));
    url.searchParams.set(
      'fields',
      'nextPageToken, files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress),webViewLink,iconLink,capabilities(canDownload))',
    );
    url.searchParams.set('pageSize', String(Math.min(Number(body.pageSize) || 25, 50)));
    url.searchParams.set('orderBy', 'modifiedTime desc');
    if (body.pageToken) url.searchParams.set('pageToken', String(body.pageToken));
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('corpora', 'user');

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': driveKey,
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[gdocs-search] gateway error', resp.status, text);
      if (resp.status === 401 || resp.status === 403) {
        return jsonResponse(
          { error: 'google_docs_permission_denied', message: 'Google Docs access was denied. Please reconnect with read access.' },
          resp.status,
        );
      }
      return jsonResponse(
        { error: 'google_docs_search_failed', message: `Google Docs search failed (${resp.status}).` },
        502,
      );
    }

    const data = await resp.json();
    const files = (data.files || []).map((f: any) => {
      const canDownload = f.capabilities?.canDownload !== false;
      const owner0 = f.owners?.[0];
      return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        ownerName: owner0?.displayName || null,
        ownerEmail: owner0?.emailAddress || null,
        webViewLink: f.webViewLink || null,
        iconLink: f.iconLink || null,
        canDownload,
        supported: canDownload,
      };
    });

    return jsonResponse({ files, nextPageToken: data.nextPageToken || null });
  } catch (err: any) {
    console.error('[gdocs-search] unexpected', err);
    return jsonResponse({ error: 'internal_error', message: err?.message || 'Unknown error' }, 500);
  }
});
