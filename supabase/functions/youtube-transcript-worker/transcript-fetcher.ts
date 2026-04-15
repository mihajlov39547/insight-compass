/**
 * YouTube transcript fetching (SerpApi primary) with non-blocking metadata probes.
 *
 * Strategy order:
 * 1. SerpApi YouTube Video Transcript API (primary)
 * 2. Page metadata probe — extract title + INNERTUBE_API_KEY from HTML (non-blocking)
 */

// @ts-nocheck

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const WORKER_USER_AGENT = "insight-compass-transcript-worker/1.0";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StrategyResult {
  transcript: string;
  strategy: string;
  language: string;
  trackCount: number;
  meta?: Record<string, string>;
}

export interface StageDebugEntry {
  stage: string;
  pageVariant?: string;
  status: "skipped" | "failed" | "success";
  reason?: string;
  trackCount?: number;
  chosenLang?: string;
  chosenKind?: string;
  httpStatus?: number;
  innertubeKey?: string | null;
  innertubeKeySource?: string;
}

export interface TranscriptDebugPayload {
  stages: StageDebugEntry[];
  winningStrategy: string | null;
  pageVariantsAttempted: string[];
  pageExtractedInnertubeKey: string | null;
  envInnertubeKeyPresent: boolean;
  serpapiAttempted: boolean;
  serpapiSearchId: string | null;
  serpapiLanguageCode: string | null;
  serpapiError: string | null;
  youtubeTitle: string | null;
  youtubeSubtitle: string | null;
  totalDurationMs: number;
}

export interface TranscriptFetchResult {
  transcript: string;
  debug: TranscriptDebugPayload;
  videoTitle?: string | null;
  videoSubtitle?: string | null;
}

interface PageExtraction {
  innertubeApiKey: string | null;
  clientVersion: string | null;
  captionTrackCount: number;
  visitorData: string | null;
  videoTitle: string | null;
}

interface OEmbedMetadata {
  title: string | null;
  subtitle: string | null;
}

interface PageHtmlVariant {
  label: string;
  html: string;
}

interface SerpApiAttemptResult {
  attempted: boolean;
  httpStatus?: number;
  reason?: string;
  searchId: string | null;
  languageCode: string | null;
  result: StrategyResult | null;
}

const SERPAPI_KEY = Deno.env.get("SERPAPI_KEY")?.trim() || "";
const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const SERPAPI_DEFAULT_LANGUAGE = Deno.env.get("YT_TRANSCRIPT_SERPAPI_LANGUAGE_CODE")?.trim() || "en";
const SERPAPI_TRANSCRIPT_TYPE = Deno.env.get("YT_TRANSCRIPT_SERPAPI_TYPE")?.trim() || "asr";
const SERPAPI_NO_CACHE = (Deno.env.get("YT_TRANSCRIPT_SERPAPI_NO_CACHE") || "false").trim().toLowerCase() === "true";

async function tryFetchYouTubeOEmbedMetadata(videoId: string): Promise<OEmbedMetadata> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const resp = await fetch(url, {
      headers: { "User-Agent": WORKER_USER_AGENT },
    });
    if (!resp.ok) {
      return { title: null, subtitle: null };
    }

    const payload = await resp.json();
    const title = typeof payload?.title === "string" ? payload.title.trim() : "";
    const author = typeof payload?.author_name === "string" ? payload.author_name.trim() : "";

    return {
      title: title || null,
      subtitle: author || null,
    };
  } catch {
    return { title: null, subtitle: null };
  }
}

/* ------------------------------------------------------------------ */
/*  Strategy 0: SerpApi YouTube Transcript API (primary)              */
/* ------------------------------------------------------------------ */

async function trySerpApiTranscript(videoId: string): Promise<SerpApiAttemptResult> {
  if (!SERPAPI_KEY) {
    return {
      attempted: false,
      reason: "serpapi_missing_key",
      searchId: null,
      languageCode: null,
      result: null,
    };
  }

  const params = new URLSearchParams({
    engine: "youtube_video_transcript",
    v: videoId,
    api_key: SERPAPI_KEY,
    language_code: SERPAPI_DEFAULT_LANGUAGE,
  });

  if (SERPAPI_TRANSCRIPT_TYPE) {
    params.set("type", SERPAPI_TRANSCRIPT_TYPE);
  }
  if (SERPAPI_NO_CACHE) {
    params.set("no_cache", "true");
  }

  const url = `${SERPAPI_ENDPOINT}?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    console.log("[transcript] Strategy 0 (serpapi): requesting youtube_video_transcript");

    const resp = await fetch(url, {
      headers: { "User-Agent": WORKER_USER_AGENT },
      signal: controller.signal,
    });

    if (!resp.ok) {
      return {
        attempted: true,
        httpStatus: resp.status,
        reason: `serpapi_http_error_${resp.status}`,
        searchId: null,
        languageCode: null,
        result: null,
      };
    }

    let payload: any;
    try {
      payload = await resp.json();
    } catch {
      return {
        attempted: true,
        httpStatus: resp.status,
        reason: "serpapi_parse_error",
        searchId: null,
        languageCode: null,
        result: null,
      };
    }

    const searchStatus = payload?.search_metadata?.status;
    const searchId = payload?.search_metadata?.id ?? null;
    const languageCode =
      payload?.search_parameters?.language_code
      ?? payload?.transcript_language
      ?? SERPAPI_DEFAULT_LANGUAGE
      ?? null;

    if (typeof searchStatus === "string" && searchStatus.toLowerCase() === "error") {
      return {
        attempted: true,
        httpStatus: resp.status,
        reason: "serpapi_processing_error",
        searchId,
        languageCode,
        result: null,
      };
    }

    const transcriptRows = Array.isArray(payload?.transcript) ? payload.transcript : [];
    const snippets = transcriptRows
      .map((row: any) => (typeof row?.snippet === "string" ? row.snippet.trim() : ""))
      .filter((snippet: string) => snippet.length > 0);

    if (snippets.length === 0) {
      return {
        attempted: true,
        httpStatus: resp.status,
        reason: "serpapi_no_transcript",
        searchId,
        languageCode,
        result: null,
      };
    }

    const transcript = snippets.join("\n\n").trim();
    if (!transcript) {
      return {
        attempted: true,
        httpStatus: resp.status,
        reason: "serpapi_no_transcript",
        searchId,
        languageCode,
        result: null,
      };
    }

    return {
      attempted: true,
      httpStatus: resp.status,
      reason: "ok",
      searchId,
      languageCode,
      result: {
        transcript,
        strategy: "serpapi_youtube_video_transcript",
        language: languageCode || "en",
        trackCount: snippets.length,
        meta: {
          provider: "serpapi",
          search_id: searchId || "",
        },
      },
    };
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    return {
      attempted: true,
      reason: isAbort ? "serpapi_timeout" : "serpapi_request_error",
      searchId: null,
      languageCode: null,
      result: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------ */
/*  HTML entity decoding                                               */
/* ------------------------------------------------------------------ */

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

/* ------------------------------------------------------------------ */
/*  Page HTML fetching                                                 */
/* ------------------------------------------------------------------ */

async function fetchPageHtmlVariants(videoId: string): Promise<PageHtmlVariant[]> {
  const pages = [
    {
      label: "embed",
      url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
    {
      label: "watch+consent",
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "CONSENT=PENDING+987",
      },
    },
    {
      label: "watch",
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
  ];

  const variants: PageHtmlVariant[] = [];

  for (const page of pages) {
    console.log(`[transcript] page-fetch (${page.label}): GET ${page.url}`);
    try {
      const resp = await fetch(page.url, { headers: page.headers });
      if (!resp.ok) {
        console.log(
          `[transcript] page-fetch (${page.label}): returned ${resp.status}`
        );
        continue;
      }
      const html = await resp.text();
      if (html.length > 1000) {
        console.log(
          `[transcript] page-fetch (${page.label}): got ${html.length} bytes`
        );
        variants.push({ label: page.label, html });
        continue;
      }
      console.log(
        `[transcript] page-fetch (${page.label}): response too short (${html.length})`
      );
    } catch (err) {
      console.log(`[transcript] page-fetch (${page.label}): error: ${err}`);
    }
  }

  return variants;
}

/* ------------------------------------------------------------------ */
/*  Extract runtime config from page HTML                              */
/* ------------------------------------------------------------------ */

function extractPageConfig(html: string): PageExtraction {
  const result: PageExtraction = {
    innertubeApiKey: null,
    clientVersion: null,
    captionTrackCount: 0,
    visitorData: null,
    videoTitle: null,
  };

  const decode = (value: string | null): string | null => {
    if (!value) return null;
    const normalized = decodeHtmlEntities(value).trim();
    return normalized.length > 0 ? normalized : null;
  };

  const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (ogTitleMatch) {
    result.videoTitle = decode(ogTitleMatch[1]);
  }

  if (!result.videoTitle) {
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      const cleaned = decode(titleMatch[1]);
      result.videoTitle = cleaned?.replace(/\s*-\s*YouTube\s*$/i, "") ?? null;
    }
  }

  if (result.videoTitle && /^youtube$/i.test(result.videoTitle.trim())) {
    result.videoTitle = null;
  }

  // Extract INNERTUBE_API_KEY
  const keyPatterns = [
    /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/,
    /innertubeApiKey['"]\s*:\s*['"]([\w-]+)['"]/,
    /ytcfg\.set\(\s*\{[^}]*"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/s,
  ];
  for (const pat of keyPatterns) {
    const m = html.match(pat);
    if (m) {
      result.innertubeApiKey = m[1];
      break;
    }
  }

  // Extract client version
  const versionPatterns = [
    /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/,
    /clientVersion['"]\s*:\s*['"]([\d.]+)['"]/,
  ];
  for (const pat of versionPatterns) {
    const m = html.match(pat);
    if (m) {
      result.clientVersion = m[1];
      break;
    }
  }

  // Extract visitorData
  const visitorMatch = html.match(/"visitorData"\s*:\s*"([^"]+)"/);
  if (visitorMatch) result.visitorData = visitorMatch[1];

  const captionTracksMatch = html.match(/"captionTracks"\s*:\s*\[/s);
  if (captionTracksMatch) {
    result.captionTrackCount = 1;
  }

  console.log(
    `[transcript] page-config: key=${result.innertubeApiKey ? "found" : "missing"}, clientVersion=${result.clientVersion ?? "missing"}, captionTrackCount=${result.captionTrackCount}, visitorData=${result.visitorData ? "found" : "missing"}`
  );

  return result;
}

const ENV_INNERTUBE_API_KEY = Deno.env.get("INNERTUBE_API_KEY")?.trim() || "";

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function fetchTranscriptForVideo(
  videoId: string
): Promise<TranscriptFetchResult> {
  console.log(`[transcript] Starting transcript fetch for videoId=${videoId}`);

  const t0 = Date.now();
  const stageEntries: StageDebugEntry[] = [];
  const pageVariantsAttempted: string[] = [];
  let pageExtractedKey: string | null = null;
  let serpapiAttempted = false;
  let serpapiSearchId: string | null = null;
  let serpapiLanguageCode: string | null = null;
  let serpapiError: string | null = null;
  let videoTitle: string | null = null;
  let videoSubtitle: string | null = null;

  function addStage(entry: StageDebugEntry) {
    stageEntries.push(entry);
  }

  function buildDebug(winner: string | null): TranscriptDebugPayload {
    return {
      stages: stageEntries,
      winningStrategy: winner,
      pageVariantsAttempted,
      pageExtractedInnertubeKey: pageExtractedKey,
      envInnertubeKeyPresent: !!ENV_INNERTUBE_API_KEY,
      serpapiAttempted,
      serpapiSearchId,
      serpapiLanguageCode,
      serpapiError,
      youtubeTitle: videoTitle,
      youtubeSubtitle: videoSubtitle,
      totalDurationMs: Date.now() - t0,
    };
  }

  // Non-blocking oEmbed metadata fetch for exact title/channel.
  const oembed = await tryFetchYouTubeOEmbedMetadata(videoId);
  if (oembed.title) videoTitle = oembed.title;
  if (oembed.subtitle) videoSubtitle = oembed.subtitle;

  function buildStageSummary(): string {
    const ordered = [
      'serpapi_primary',
      'page_fetch',
      'page_config_extract',
    ];
    const seen = new Set(stageEntries.map((s) => s.stage));
    return ordered.filter((stage) => seen.has(stage)).join(' → ');
  }

  // Strategy 0: SerpApi primary provider
  const serpapi = await trySerpApiTranscript(videoId);
  serpapiAttempted = serpapi.attempted;
  serpapiSearchId = serpapi.searchId;
  serpapiLanguageCode = serpapi.languageCode;
  serpapiError = serpapi.reason && serpapi.reason !== "ok" ? serpapi.reason : null;

  if (serpapi.result) {
    addStage({
      stage: "serpapi_primary",
      status: "success",
      reason: "serpapi transcript fetched",
      httpStatus: serpapi.httpStatus,
      trackCount: serpapi.result.trackCount,
      chosenLang: serpapi.result.language,
    });
    console.log(`[transcript] ✅ Success via ${serpapi.result.strategy}`);
  } else {
    addStage({
      stage: "serpapi_primary",
      status: serpapi.attempted ? "failed" : "skipped",
      reason: serpapi.reason || (serpapi.attempted ? "serpapi_unknown_error" : "serpapi_missing_key"),
      httpStatus: serpapi.httpStatus,
    });
  }

  // Non-blocking metadata probe (title + page-extracted InnerTube key).
  // This should never fail the pipeline.
  const pageVariants = await fetchPageHtmlVariants(videoId);
  if (pageVariants.length === 0) {
    addStage({ stage: "page_fetch", status: "failed", reason: "all page variants failed" });
  } else {
    addStage({ stage: "page_fetch", status: "success", reason: `${pageVariants.length} variant(s) fetched` });
  }

  for (const variant of pageVariants) {
    pageVariantsAttempted.push(variant.label);
    const pageConfig = extractPageConfig(variant.html);
    addStage({
      stage: "page_config_extract",
      pageVariant: variant.label,
      status: "success",
      trackCount: pageConfig.captionTrackCount,
      reason: pageConfig.innertubeApiKey ? "page key found" : "page key missing",
    });

    if (pageConfig.innertubeApiKey && !pageExtractedKey) {
      pageExtractedKey = pageConfig.innertubeApiKey;
    }
    if (pageConfig.videoTitle && !videoTitle) {
      videoTitle = pageConfig.videoTitle;
    }

    console.log(
      `[transcript] page-config (${variant.label}): key=${pageConfig.innertubeApiKey ? "found" : "missing"}, captionTrackCount=${pageConfig.captionTrackCount}`
    );
  }

  if (serpapi.result) {
    return {
      transcript: serpapi.result.transcript,
      debug: buildDebug(serpapi.result.strategy),
      videoTitle,
      videoSubtitle,
    };
  }

  const debug = buildDebug(null);
  const stageNames = buildStageSummary();
  console.log(`[transcript] ❌ All strategies exhausted. Stages: ${stageNames}`);
  const err = new Error(`No transcript tracks available for this video (stages: ${stageNames})`);
  (err as any).debug = debug;
  throw err;
}
