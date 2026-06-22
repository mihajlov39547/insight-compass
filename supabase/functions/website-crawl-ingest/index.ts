// Crawl a website root URL with Tavily and ingest the results as a single
// "website" Document, processed via document_processing_v1.
//
// - Reuses Tavily /crawl (markdown format, allow_external=false, max_depth=5).
// - Tier-driven crawl params (Free/Basic/Premium/Enterprise) enforced server-side.
// - Stores only metadata + crawled markdown bytes in a temporary storage object;
//   the document is marked storage_mode='external_reference' so the temp object
//   is deleted by the existing finalize stage after processing.
// - includeImages = pass-through to Tavily; image URLs are stored in
//   external_metadata only (we never download images).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TAVILY_CRAWL_URL = 'https://api.tavily.com/crawl';

type Tier = 'free' | 'basic' | 'premium' | 'enterprise';

interface TierParams {
  limit: number;
  maxBreadth: number;
  extractDepth: 'basic' | 'advanced';
  chunksPerSource: number;
}

const TIER_PARAMS: Record<Tier, TierParams> = {
  free: { limit: 25, maxBreadth: 20, extractDepth: 'basic', chunksPerSource: 1 },
  basic: { limit: 100, maxBreadth: 50, extractDepth: 'advanced', chunksPerSource: 3 },
  premium: { limit: 200, maxBreadth: 100, extractDepth: 'advanced', chunksPerSource: 5 },
  enterprise: { limit: 200, maxBreadth: 100, extractDepth: 'advanced', chunksPerSource: 5 },
};

const MAX_INSTRUCTIONS_LENGTH = 1000;
const MAX_DEPTH = 5;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::1') return true;
  // IPv4 private/reserved
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }
  // IPv6 loopback / private prefixes
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

function normalizeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (isPrivateHost(u.hostname)) return null;
    u.hash = '';
    return u;
  } catch {
    return null;
  }
}

function deriveTitle(u: URL, providedTitle?: string | null): string {
  if (providedTitle && providedTitle.trim()) return providedTitle.trim().slice(0, 200);
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname.replace(/\/$/, '');
  return path && path !== '' ? `${host}${path}` : host;
}

function buildMarkdown(rootUrl: string, instructions: string | null, results: any[]): string {
  const lines: string[] = [];
  lines.push(`# Website crawl: ${rootUrl}`);
  lines.push('');
  if (instructions) {
    lines.push(`> Crawler instructions: ${instructions}`);
    lines.push('');
  }
  lines.push(`Crawled ${results.length} page(s).`);
  lines.push('');
  for (let i = 0; i < results.length; i++) {
    const r = results[i] || {};
    const url = typeof r.url === 'string' ? r.url : '';
    const content = typeof r.raw_content === 'string' ? r.raw_content : '';
    if (!url) continue;
    lines.push('---');
    lines.push('');
    lines.push(`## Page ${i + 1}: ${url}`);
    lines.push('');
    if (content.trim()) {
      lines.push(content.trim());
    } else {
      lines.push('_No readable content extracted from this page._');
    }
    lines.push('');
  }
  return lines.join('\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const tavilyKey = Deno.env.get('TAVILY_API_KEY');
    if (!tavilyKey) {
      return jsonResponse({ error: 'tavily_not_configured', message: 'TAVILY_API_KEY is not configured.' }, 500);
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
    const rawUrl = String(body.url || '').trim();
    const instructionsRaw = typeof body.instructions === 'string' ? body.instructions.trim() : '';
    const instructions = instructionsRaw ? instructionsRaw.slice(0, MAX_INSTRUCTIONS_LENGTH) : null;
    const includeImages = body.includeImages === true;
    const containerType = body.containerType as 'project' | 'notebook';
    const containerId = body.containerId ? String(body.containerId) : null;

    if (!containerId || (containerType !== 'project' && containerType !== 'notebook')) {
      return jsonResponse({ error: 'invalid_input', message: 'containerType and containerId are required.' }, 400);
    }

    const url = normalizeUrl(rawUrl);
    if (!url) {
      return jsonResponse(
        { error: 'invalid_url', message: 'Provide a public http(s) URL. Local, private, or internal addresses are not allowed.' },
        400,
      );
    }

    // Permission check
    const { data: hasPerm, error: permErr } = await userClient.rpc('check_item_permission', {
      p_user_id: userId,
      p_item_id: containerId,
      p_item_type: containerType,
      p_min_role: 'editor',
    });
    if (permErr || !hasPerm) {
      return jsonResponse({ error: 'forbidden', message: 'You do not have edit access to this workspace.' }, 403);
    }

    // Resolve plan tier (server-side)
    const admin = createClient(supaUrl, supaService, { auth: { persistSession: false } });
    let tier: Tier = 'free';
    try {
      const { data: profile } = await admin.from('profiles').select('plan').eq('id', userId).maybeSingle();
      const p = String(profile?.plan || '').toLowerCase();
      if (p === 'basic' || p === 'premium' || p === 'enterprise') tier = p as Tier;
    } catch (_) { /* default to free */ }
    const params = TIER_PARAMS[tier];

    // Tavily crawl
    const crawlPayload: Record<string, unknown> = {
      url: url.toString(),
      extract_depth: params.extractDepth,
      format: 'markdown',
      include_favicon: true,
      include_images: includeImages,
      max_depth: MAX_DEPTH,
      max_breadth: params.maxBreadth,
      limit: params.limit,
      allow_external: false,
      chunks_per_source: params.chunksPerSource,
    };
    if (instructions) crawlPayload.instructions = instructions;

    const crawlResp = await fetch(TAVILY_CRAWL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tavilyKey}`,
      },
      body: JSON.stringify(crawlPayload),
    });

    if (!crawlResp.ok) {
      const text = await crawlResp.text().catch(() => '');
      console.error('[website-crawl-ingest] tavily fail', crawlResp.status, text.slice(0, 400));
      if (crawlResp.status === 429) {
        return jsonResponse({ error: 'crawl_rate_limited', message: 'Crawler is rate limited. Try again shortly.' }, 429);
      }
      return jsonResponse({ error: 'crawl_failed', message: `Crawl failed (${crawlResp.status}). The website may be unreachable.` }, 502);
    }

    const data = await crawlResp.json().catch(() => ({}));
    const results = Array.isArray(data?.results) ? data.results : [];
    const baseUrl = typeof data?.base_url === 'string' ? data.base_url : url.toString();

    if (results.length === 0) {
      return jsonResponse({ error: 'no_content', message: 'No crawlable content was found at this URL.' }, 422);
    }

    const imageUrls: string[] = [];
    if (includeImages) {
      for (const r of results) {
        const imgs = Array.isArray(r?.images) ? r.images : [];
        for (const img of imgs) {
          if (typeof img === 'string') imageUrls.push(img);
          else if (img && typeof img.url === 'string') imageUrls.push(img.url);
        }
      }
    }

    const markdown = buildMarkdown(url.toString(), instructions, results);
    const bytes = new TextEncoder().encode(markdown);

    // Insert document + temp markdown in storage. storage_mode='external_reference'
    // means the finalize stage will delete the temp object after processing.
    const projectIdForPath = containerType === 'project' ? containerId : 'notebooks';
    const newDocId = crypto.randomUUID();
    const storagePath = `${userId}/${projectIdForPath}/${newDocId}.md`;
    const safeTitle = deriveTitle(url, body?.title || null);
    const fileName = `${safeTitle.replace(/[/\\]+/g, '_').slice(0, 180)}.md`;

    const { error: storageErr } = await admin.storage
      .from('insight-navigator')
      .upload(storagePath, bytes, { contentType: 'text/markdown', upsert: false });
    if (storageErr) {
      console.error('[website-crawl-ingest] storage upload failed', storageErr.message);
      return jsonResponse({ error: 'storage_failed', message: storageErr.message }, 500);
    }

    const crawledUrls = results.map((r: any) => (typeof r?.url === 'string' ? r.url : '')).filter(Boolean);

    const insertRow: Record<string, unknown> = {
      id: newDocId,
      user_id: userId,
      project_id: containerType === 'project' ? containerId : null,
      notebook_id: containerType === 'notebook' ? containerId : null,
      chat_id: null,
      file_name: fileName,
      file_type: 'md',
      mime_type: 'text/markdown',
      file_size: bytes.byteLength,
      storage_path: storagePath,
      processing_status: 'uploaded',
      provider: 'website',
      external_url: url.toString(),
      external_metadata: {
        crawl_root_url: url.toString(),
        crawl_base_url: baseUrl,
        crawl_instructions: instructions,
        include_images: includeImages,
        crawl_limit: params.limit,
        max_depth: MAX_DEPTH,
        max_breadth: params.maxBreadth,
        extract_depth: params.extractDepth,
        chunks_per_source: params.chunksPerSource,
        crawled_pages: results.length,
        crawled_urls: crawledUrls.slice(0, 500),
        image_urls: includeImages ? imageUrls.slice(0, 500) : [],
        tavily_request_id: typeof data?.request_id === 'string' ? data.request_id : null,
        tavily_response_time: typeof data?.response_time === 'number' ? data.response_time : null,
        tier,
      },
      storage_mode: 'external_reference',
    };

    const { data: inserted, error: insertErr } = await admin
      .from('documents')
      .insert(insertRow)
      .select('id, storage_path')
      .single();

    if (insertErr) {
      await admin.storage.from('insight-navigator').remove([storagePath]).catch(() => {});
      console.error('[website-crawl-ingest] insert failed', insertErr);
      return jsonResponse({ error: 'insert_failed', message: insertErr.message }, 500);
    }

    // Kick processing workflow
    try {
      await fetch(`${supaUrl}/functions/v1/workflow-start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supaService}`,
        },
        body: JSON.stringify({
          definition_key: 'document_processing_v1',
          input_payload: {
            document_id: inserted.id,
            source: 'website_crawl',
            source_document_id: inserted.id,
            source_storage_path: inserted.storage_path,
            initiated_at: new Date().toISOString(),
          },
          user_id: userId,
          trigger_entity_type: 'document',
          trigger_entity_id: inserted.id,
          idempotency_key: `website-workflow-${inserted.id}`,
          create_initial_context_snapshot: true,
        }),
      });
    } catch (err) {
      console.warn('[website-crawl-ingest] workflow-start error', err);
    }

    return jsonResponse({
      documentId: inserted.id,
      title: fileName,
      provider: 'website',
      pages: results.length,
      tier,
      status: 'queued',
    });
  } catch (err: any) {
    console.error('[website-crawl-ingest] unexpected', err);
    return jsonResponse({ error: 'internal_error', message: err?.message || 'Unknown error' }, 500);
  }
});
