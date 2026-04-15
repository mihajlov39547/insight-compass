/**
 * YouTube transcript fetching with multi-strategy discovery.
 *
 * Strategy order:
 * 1. SerpApi YouTube Video Transcript API (primary)
 * 2. Legacy timedtext list API (fast, no page scrape)
 * 3. Page scrape — extract captionTracks + INNERTUBE_API_KEY from HTML
 *    3a. Use captionTracks directly if found in page data
 *    3b. Use page-extracted INNERTUBE_API_KEY to call InnerTube player API
 * 4. Env-key InnerTube fallback (uses INNERTUBE_API_KEY from env if set)
 */

// @ts-nocheck

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const WORKER_USER_AGENT = "insight-compass-transcript-worker/1.0";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string };
  vssId?: string;
}

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
  totalDurationMs: number;
}

export interface TranscriptFetchResult {
  transcript: string;
  debug: TranscriptDebugPayload;
  videoTitle?: string | null;
}

interface PageExtraction {
  innertubeApiKey: string | null;
  clientVersion: string | null;
  captionTracks: CaptionTrack[];
  visitorData: string | null;
  videoTitle: string | null;
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
const SERPAPI_TRANSCRIPT_TYPE = Deno.env.get("YT_TRANSCRIPT_SERPAPI_TYPE")?.trim() || "";
const SERPAPI_NO_CACHE = (Deno.env.get("YT_TRANSCRIPT_SERPAPI_NO_CACHE") || "false").trim().toLowerCase() === "true";

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
/*  XML text extraction                                                */
/* ------------------------------------------------------------------ */

export function extractTextLines(xml: string): string[] {
  const lines: string[] = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const decoded = decodeHtmlEntities(match[1])
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (decoded) lines.push(decoded);
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/*  Caption track selection                                            */
/* ------------------------------------------------------------------ */

function pickBestTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;

  // Prefer manual English captions
  const manualEn = tracks.find(
    (t) => t.languageCode === "en" && (!t.kind || t.kind !== "asr")
  );
  if (manualEn) return manualEn;

  // Any manual caption
  const manual = tracks.find((t) => !t.kind || t.kind !== "asr");
  if (manual) return manual;

  // Auto-generated English
  const autoEn = tracks.find(
    (t) => t.languageCode === "en" && t.kind === "asr"
  );
  if (autoEn) return autoEn;

  // First available
  return tracks[0];
}

function logTracks(label: string, tracks: CaptionTrack[]) {
  const languages = tracks.map(
    (t) => `${t.languageCode}${t.kind === "asr" ? "(auto)" : ""}`
  );
  console.log(`[transcript] ${label}: languages=[${languages.join(", ")}]`);
}

/* ------------------------------------------------------------------ */
/*  Fetch transcript XML from a caption track                          */
/* ------------------------------------------------------------------ */

async function fetchTranscriptFromTrack(
  track: CaptionTrack,
  label: string
): Promise<{ lines: string[]; url: string } | null> {
  const baseUrl = track.baseUrl.replace(/\\u0026/g, "&");
  const urls = [baseUrl + "&fmt=srv3", baseUrl];

  for (const url of urls) {
    try {
      console.log(
        `[transcript] ${label}: fetching transcript from ${url.substring(0, 120)}...`
      );
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!resp.ok) {
        console.log(
          `[transcript] ${label}: transcript endpoint returned ${resp.status}`
        );
        continue;
      }
      const xml = await resp.text();
      const lines = extractTextLines(xml);
      if (lines.length > 0) {
        console.log(`[transcript] ${label}: extracted ${lines.length} text lines`);
        return { lines, url };
      }
    } catch (err) {
      console.log(`[transcript] ${label}: fetch error: ${err}`);
    }
  }
  return null;
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
    captionTracks: [],
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

  // Extract captionTracks from ytInitialPlayerResponse
  const playerPatterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script>)/s,
    /"captions"\s*:\s*(\{"playerCaptionsTracklistRenderer".+?\})\s*,\s*"videoDetails"/s,
  ];
  for (const pat of playerPatterns) {
    const m = html.match(pat);
    if (!m) continue;
    try {
      const json = JSON.parse(m[1]);
      const tracks =
        json?.captions?.playerCaptionsTracklistRenderer?.captionTracks
        ?? json?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        result.captionTracks = tracks;
        break;
      }
    } catch {
      // continue
    }
  }

  // Fallback: direct captionTracks extraction
  if (result.captionTracks.length === 0) {
    const directMatch = html.match(/"captionTracks"\s*:\s*(\[.+?\])/s);
    if (directMatch) {
      try {
        const tracks = JSON.parse(directMatch[1]);
        if (Array.isArray(tracks) && tracks.length > 0) {
          result.captionTracks = tracks;
        }
      } catch {
        // ignore
      }
    }
  }

  console.log(
    `[transcript] page-config: key=${result.innertubeApiKey ? "found" : "missing"}, clientVersion=${result.clientVersion ?? "missing"}, captionTracks=${result.captionTracks.length}, visitorData=${result.visitorData ? "found" : "missing"}`
  );

  return result;
}

/* ------------------------------------------------------------------ */
/*  Strategy 1: Legacy timedtext list API                              */
/* ------------------------------------------------------------------ */

function pickLanguageFromListXml(xml: string): string | null {
  const languages: string[] = [];
  const regex = /lang_code="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    languages.push(match[1]);
  }
  if (languages.length === 0) return null;
  const preferred = ["en", "en-US", "en-GB"];
  for (const candidate of preferred) {
    if (languages.includes(candidate)) return candidate;
  }
  return languages[0];
}

async function tryLegacyTimedtextApi(
  videoId: string
): Promise<StrategyResult | null> {
  const listUrl = `https://video.google.com/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
  console.log(`[transcript] Strategy 1 (legacy): fetching timedtext list`);

  const listResp = await fetch(listUrl, {
    headers: { "User-Agent": WORKER_USER_AGENT },
  });
  if (!listResp.ok) {
    console.log(`[transcript] Strategy 1: list endpoint returned ${listResp.status}`);
    return null;
  }

  const listXml = await listResp.text();
  if (!listXml || listXml.trim().length === 0) {
    console.log(`[transcript] Strategy 1: empty response`);
    return null;
  }

  const language = pickLanguageFromListXml(listXml);
  if (!language) {
    console.log(`[transcript] Strategy 1: no lang_code found`);
    return null;
  }

  console.log(`[transcript] Strategy 1: found language=${language}`);

  const endpoints = [
    `https://video.google.com/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(language)}`,
    `https://video.google.com/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(language)}&fmt=srv3`,
  ];

  for (const endpoint of endpoints) {
    const resp = await fetch(endpoint, {
      headers: { "User-Agent": WORKER_USER_AGENT },
    });
    if (!resp.ok) continue;
    const xml = await resp.text();
    const lines = extractTextLines(xml);
    if (lines.length > 0) {
      return {
        transcript: lines.join("\n"),
        strategy: "legacy_timedtext",
        language,
        trackCount: 1,
        meta: { caption_strategy: "legacy_timedtext", innertube_key_source: "n/a" },
      };
    }
  }

  console.log(`[transcript] Strategy 1: tracks found but content empty`);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Strategy 2a: Use captionTracks already in page HTML                */
/* ------------------------------------------------------------------ */

async function tryPageCaptionTracks(
  pageConfig: PageExtraction
): Promise<StrategyResult | null> {
  const tracks = pageConfig.captionTracks;
  if (tracks.length === 0) return null;

  console.log(`[transcript] Strategy 2a (page captionTracks): ${tracks.length} tracks`);
  logTracks("Strategy 2a", tracks);

  const chosen = pickBestTrack(tracks);
  if (!chosen) return null;

  const trackLabel = chosen.name?.simpleText ?? chosen.languageCode;
  console.log(
    `[transcript] Strategy 2a: chose ${trackLabel} (lang=${chosen.languageCode}, kind=${chosen.kind ?? "manual"})`
  );

  const result = await fetchTranscriptFromTrack(chosen, "Strategy 2a");
  if (!result) {
    console.log(`[transcript] Strategy 2a: content extraction failed`);
    return null;
  }

  return {
    transcript: result.lines.join("\n"),
    strategy: "page_caption_tracks",
    language: chosen.languageCode,
    trackCount: tracks.length,
    meta: {
      caption_strategy: "page_caption_tracks",
      caption_track_kind: chosen.kind ?? "manual",
      caption_language: chosen.languageCode,
      innertube_key_source: "n/a",
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Strategy 2b: Page-extracted InnerTube key → player API             */
/* ------------------------------------------------------------------ */

async function tryPageExtractedInnertube(
  videoId: string,
  pageConfig: PageExtraction
): Promise<StrategyResult | null> {
  if (!pageConfig.innertubeApiKey) {
    console.log(`[transcript] Strategy 2b: no INNERTUBE_API_KEY found in page`);
    return null;
  }

  const apiKey = pageConfig.innertubeApiKey;
  const clientVersion = pageConfig.clientVersion || "2.20240313.05.00";

  const clients = [
    {
      label: "WEB",
      clientName: "WEB",
      clientVersion,
    },
    {
      label: "EMBEDDED",
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
    },
  ];

  for (const client of clients) {
    console.log(
      `[transcript] Strategy 2b (page-key/${client.label}): calling InnerTube player API`
    );

    try {
      const apiUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`;
      const body: any = {
        context: {
          client: {
            hl: "en",
            gl: "US",
            clientName: client.clientName,
            clientVersion: client.clientVersion,
          },
        },
        videoId,
      };
      if (pageConfig.visitorData) {
        body.context.client.visitorData = pageConfig.visitorData;
      }

      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        console.log(
          `[transcript] Strategy 2b (${client.label}): InnerTube returned ${resp.status}`
        );
        continue;
      }

      const data = await resp.json();
      const tracks: CaptionTrack[] =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      console.log(
        `[transcript] Strategy 2b (${client.label}): found ${tracks.length} caption tracks`
      );

      if (tracks.length === 0) continue;

      logTracks(`Strategy 2b (${client.label})`, tracks);
      const chosen = pickBestTrack(tracks);
      if (!chosen) continue;

      const trackLabel = chosen.name?.simpleText ?? chosen.languageCode;
      console.log(
        `[transcript] Strategy 2b (${client.label}): chose ${trackLabel} (lang=${chosen.languageCode}, kind=${chosen.kind ?? "manual"})`
      );

      const result = await fetchTranscriptFromTrack(
        chosen,
        `Strategy 2b (${client.label})`
      );
      if (!result) continue;

      return {
        transcript: result.lines.join("\n"),
        strategy: `innertube_page_key_${client.label.toLowerCase()}`,
        language: chosen.languageCode,
        trackCount: tracks.length,
        meta: {
          caption_strategy: `innertube_page_key_${client.label.toLowerCase()}`,
          caption_track_kind: chosen.kind ?? "manual",
          caption_language: chosen.languageCode,
          innertube_key_source: "page_extracted",
          innertube_client: client.clientName,
        },
      };
    } catch (err) {
      console.log(
        `[transcript] Strategy 2b (${client.label}): error: ${err}`
      );
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Strategy 3: Env-key InnerTube fallback                             */
/* ------------------------------------------------------------------ */

const ENV_INNERTUBE_API_KEY = Deno.env.get("INNERTUBE_API_KEY")?.trim() || "";

async function tryEnvKeyInnertube(
  videoId: string
): Promise<StrategyResult | null> {
  if (!ENV_INNERTUBE_API_KEY) {
    console.log(
      "[transcript] Strategy 3 (env-key): INNERTUBE_API_KEY env not set; skipping"
    );
    return null;
  }

  const clients = [
    {
      label: "EMBEDDED",
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
    },
    {
      label: "WEB",
      clientName: "WEB",
      clientVersion: "2.20240313.05.00",
    },
  ];

  for (const client of clients) {
    console.log(
      `[transcript] Strategy 3 (env-key/${client.label}): calling InnerTube player API`
    );

    try {
      const apiUrl = `https://www.youtube.com/youtubei/v1/player?key=${ENV_INNERTUBE_API_KEY}&prettyPrint=false`;
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({
          context: {
            client: {
              hl: "en",
              gl: "US",
              clientName: client.clientName,
              clientVersion: client.clientVersion,
            },
          },
          videoId,
        }),
      });

      if (!resp.ok) {
        console.log(
          `[transcript] Strategy 3 (${client.label}): InnerTube returned ${resp.status}`
        );
        continue;
      }

      const data = await resp.json();
      const tracks: CaptionTrack[] =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      console.log(
        `[transcript] Strategy 3 (${client.label}): found ${tracks.length} tracks`
      );

      if (tracks.length === 0) continue;

      logTracks(`Strategy 3 (${client.label})`, tracks);
      const chosen = pickBestTrack(tracks);
      if (!chosen) continue;

      const result = await fetchTranscriptFromTrack(
        chosen,
        `Strategy 3 (${client.label})`
      );
      if (!result) continue;

      return {
        transcript: result.lines.join("\n"),
        strategy: `innertube_env_key_${client.label.toLowerCase()}`,
        language: chosen.languageCode,
        trackCount: tracks.length,
        meta: {
          caption_strategy: `innertube_env_key_${client.label.toLowerCase()}`,
          caption_track_kind: chosen.kind ?? "manual",
          caption_language: chosen.languageCode,
          innertube_key_source: "env_variable",
          innertube_client: client.clientName,
        },
      };
    } catch (err) {
      console.log(
        `[transcript] Strategy 3 (${client.label}): error: ${err}`
      );
    }
  }

  return null;
}

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
      totalDurationMs: Date.now() - t0,
    };
  }

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
      trackCount: pageConfig.captionTracks.length,
      reason: pageConfig.innertubeApiKey ? "page key found" : "page key missing",
    });

    if (pageConfig.innertubeApiKey && !pageExtractedKey) {
      pageExtractedKey = pageConfig.innertubeApiKey;
    }
    if (pageConfig.videoTitle && !videoTitle) {
      videoTitle = pageConfig.videoTitle;
    }

    console.log(
      `[transcript] page-config (${variant.label}): key=${pageConfig.innertubeApiKey ? "found" : "missing"}, tracks=${pageConfig.captionTracks.length}`
    );
  }

  if (serpapi.result) {
    return {
      transcript: serpapi.result.transcript,
      debug: buildDebug(serpapi.result.strategy),
      videoTitle,
    };
  }

  const debug = buildDebug(null);
  const stageNames = buildStageSummary();
  console.log(`[transcript] ❌ All strategies exhausted. Stages: ${stageNames}`);
  const err = new Error(`No transcript tracks available for this video (stages: ${stageNames})`);
  (err as any).debug = debug;
  throw err;
}
