// Search the connected Google Drive via the Lovable connector gateway.
// Read-only listing for the global Add Source modal.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_drive/drive/v3';
const SUPPORTED_MIME = new Set([
  'application/vnd.google-apps.document',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildQuery(input: {
  query?: string;
  mimeFilter?: 'all' | 'docs' | 'pdf' | 'text';
}): string {
  const clauses: string[] = ['trashed = false'];
  const q = (input.query || '').trim().replace(/'/g, "\\'");
  if (q) clauses.push(`name contains '${q}'`);

  const filter = input.mimeFilter || 'all';
  if (filter === 'docs') {
    clauses.push("mimeType = 'application/vnd.google-apps.document'");
  } else if (filter === 'pdf') {
    clauses.push("mimeType = 'application/pdf'");
  } else if (filter === 'text') {
    clauses.push(
      "(mimeType = 'text/plain' or mimeType = 'text/markdown' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')",
    );
  }
  return clauses.join(' and ');
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

    // Auth check
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

    const url = new URL(`${GATEWAY_URL}/files`);
    url.searchParams.set('q', buildQuery(body));
    url.searchParams.set(
      'fields',
      'nextPageToken, files(id,name,mimeType,modifiedTime,size,owners(displayName,emailAddress),webViewLink,parents,iconLink,capabilities(canDownload))',
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
      console.error('[gdrive-search] gateway error', resp.status, text);
      if (resp.status === 401 || resp.status === 403) {
        return jsonResponse(
          {
            error: 'google_drive_permission_denied',
            message: 'Google Drive access was denied. Please reconnect with read access.',
          },
          resp.status,
        );
      }
      return jsonResponse(
        { error: 'google_drive_search_failed', message: `Drive search failed (${resp.status}).` },
        502,
      );
    }

    const data = await resp.json();
    const files = (data.files || []).map((f: any) => {
      const canDownload = f.capabilities?.canDownload !== false;
      return {
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        size: f.size ? Number(f.size) : null,
        owner: f.owners?.[0]?.displayName || f.owners?.[0]?.emailAddress || null,
        webViewLink: f.webViewLink || null,
        iconLink: f.iconLink || null,
        parents: f.parents || [],
        canDownload,
        supported: SUPPORTED_MIME.has(f.mimeType) && canDownload,
      };
    });

    return jsonResponse({ files, nextPageToken: data.nextPageToken || null });
  } catch (err: any) {
    console.error('[gdrive-search] unexpected', err);
    return jsonResponse({ error: 'internal_error', message: err?.message || 'Unknown error' }, 500);
  }
});
