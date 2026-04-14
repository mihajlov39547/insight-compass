/**
 * YouTube transcript fetching with multi-strategy discovery.
 *
 * Strategy order:
 * 1. Legacy timedtext list API (fast, no page scrape)
 * 2. Page scrape — extract captionTracks + INNERTUBE_API_KEY from HTML
 *    2a. Use captionTracks directly if found in page data
 *    2b. Use page-extracted INNERTUBE_API_KEY to call InnerTube player API
 * 3. Env-key InnerTube fallback (uses INNERTUBE_API_KEY from env if set)
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
  totalDurationMs: number;
}

export interface TranscriptFetchResult {
  transcript: string;
  debug: TranscriptDebugPayload;
}

interface PageExtraction {
  innertubeApiKey: string | null;
  clientVersion: string | null;
  captionTracks: CaptionTrack[];
  visitorData: string | null;
}

interface PageHtmlVariant {
  label: string;
  html: string;
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
  };

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
): Promise<string> {
  console.log(`[transcript] Starting transcript fetch for videoId=${videoId}`);

  const stages: string[] = [];
  const markStage = (stage: string) => {
    if (!stages.includes(stage)) stages.push(stage);
  };

  // Strategy 1: Legacy timedtext API (fastest, no page scrape)
  markStage("legacy_timedtext");
  const legacy = await tryLegacyTimedtextApi(videoId);
  if (legacy) {
    console.log(
      `[transcript] ✅ Success via ${legacy.strategy}, lang=${legacy.language}, len=${legacy.transcript.length}`
    );
    return legacy.transcript;
  }

  // Fetch page HTML once — shared by strategies 2a and 2b
  markStage("page_fetch");
  const pageVariants = await fetchPageHtmlVariants(videoId);
  if (pageVariants.length === 0) {
    console.log(`[transcript] ⚠ page fetch failed for all page variants`);
  }

  for (const variant of pageVariants) {
    markStage("page_config_extract");
    const pageConfig = extractPageConfig(variant.html);

    console.log(
      `[transcript] page-config (${variant.label}): key=${pageConfig.innertubeApiKey ? "found" : "missing"}, tracks=${pageConfig.captionTracks.length}`
    );

    // Strategy 2a: captionTracks already in page
    markStage("page_caption_tracks");
    const pageTracks = await tryPageCaptionTracks(pageConfig);
    if (pageTracks) {
      console.log(
        `[transcript] ✅ Success via ${pageTracks.strategy}, lang=${pageTracks.language}, trackCount=${pageTracks.trackCount}, len=${pageTracks.transcript.length}`
      );
      return pageTracks.transcript;
    }

    // Strategy 2b: page-extracted InnerTube key
    markStage("innertube_page_key");
    const pageInnertube = await tryPageExtractedInnertube(videoId, pageConfig);
    if (pageInnertube) {
      console.log(
        `[transcript] ✅ Success via ${pageInnertube.strategy}, lang=${pageInnertube.language}, trackCount=${pageInnertube.trackCount}, len=${pageInnertube.transcript.length}`
      );
      return pageInnertube.transcript;
    }
  }

  // Strategy 3: env-key InnerTube fallback
  markStage("innertube_env_key");
  const envInnertube = await tryEnvKeyInnertube(videoId);
  if (envInnertube) {
    console.log(
      `[transcript] ✅ Success via ${envInnertube.strategy}, lang=${envInnertube.language}, trackCount=${envInnertube.trackCount}, len=${envInnertube.transcript.length}`
    );
    return envInnertube.transcript;
  }

  console.log(
    `[transcript] ❌ All strategies exhausted. Stages attempted: ${stages.join(" → ")}`
  );
  throw new Error(
    `No transcript tracks available for this video (stages: ${stages.join(" → ")})`
  );
}
