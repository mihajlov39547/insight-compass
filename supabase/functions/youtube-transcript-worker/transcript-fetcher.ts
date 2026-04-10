/**
 * YouTube transcript fetching with multi-strategy discovery.
 *
 * Strategy 1: Legacy timedtext list API (fast, no page scrape)
 * Strategy 2: Watch page scrape for ytInitialPlayerResponse captionTracks
 * Strategy 3: YouTube InnerTube API (bypasses web page rate limits)
 */

// @ts-nocheck

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const WORKER_USER_AGENT = "insight-compass-transcript-worker/1.0";

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

interface StrategyResult {
  transcript: string;
  strategy: string;
  language: string;
  trackCount: number;
}

async function tryLegacyTimedtextApi(videoId: string): Promise<StrategyResult | null> {
  const listUrl = `https://video.google.com/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
  console.log(`[transcript] Strategy 1: fetching timedtext list from ${listUrl}`);

  const listResp = await fetch(listUrl, { headers: { "User-Agent": WORKER_USER_AGENT } });
  if (!listResp.ok) {
    console.log(`[transcript] Strategy 1: list endpoint returned ${listResp.status}`);
    return null;
  }

  const listXml = await listResp.text();
  console.log(`[transcript] Strategy 1: list response length=${listXml.length}`);

  if (!listXml || listXml.trim().length === 0) {
    console.log(`[transcript] Strategy 1: empty response — no tracks via legacy API`);
    return null;
  }

  const language = pickLanguageFromListXml(listXml);
  if (!language) {
    console.log(`[transcript] Strategy 1: no lang_code found in list XML`);
    return null;
  }

  console.log(`[transcript] Strategy 1: found language=${language}`);

  const endpoints = [
    `https://video.google.com/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(language)}`,
    `https://video.google.com/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(language)}&fmt=srv3`,
  ];

  for (const endpoint of endpoints) {
    const resp = await fetch(endpoint, { headers: { "User-Agent": WORKER_USER_AGENT } });
    if (!resp.ok) continue;
    const xml = await resp.text();
    const lines = extractTextLines(xml);
    if (lines.length > 0) {
      return {
        transcript: lines.join("\n"),
        strategy: "legacy_timedtext",
        language,
        trackCount: 1,
      };
    }
  }

  console.log(`[transcript] Strategy 1: tracks found but content empty`);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Strategy 2: Watch page scrape for captionTracks                    */
/* ------------------------------------------------------------------ */

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string };
  vssId?: string;
}

function extractCaptionTracksFromHtml(html: string): CaptionTrack[] {
  // Look for ytInitialPlayerResponse or similar JSON containing captionTracks
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script>)/s,
    /"captions"\s*:\s*(\{"playerCaptionsTracklistRenderer".+?\})\s*,\s*"videoDetails"/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    try {
      const json = JSON.parse(match[1]);
      const tracks =
        json?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        return tracks;
      }
    } catch {
      // JSON parse failed, try next pattern
    }
  }

  // Fallback: direct captionTracks extraction
  const directMatch = html.match(/"captionTracks"\s*:\s*(\[.+?\])/);
  if (directMatch) {
    try {
      const tracks = JSON.parse(directMatch[1]);
      if (Array.isArray(tracks) && tracks.length > 0) {
        return tracks;
      }
    } catch {
      // ignore
    }
  }

  return [];
}

function pickBestTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;

  // Prefer manual English captions (no "kind" field or kind !== "asr")
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

async function tryWatchPageScrape(videoId: string): Promise<StrategyResult | null> {
  // Try multiple page URLs: embed page (no consent gate), watch page with consent cookie
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
        "Cookie": "CONSENT=PENDING+987",
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

  for (const page of pages) {
    console.log(`[transcript] Strategy 2 (${page.label}): fetching ${page.url}`);

    const resp = await fetch(page.url, { headers: page.headers });

    if (!resp.ok) {
      console.log(`[transcript] Strategy 2 (${page.label}): returned ${resp.status}`);
      continue;
    }

    const html = await resp.text();
    console.log(`[transcript] Strategy 2 (${page.label}): page length=${html.length}`);

    const tracks = extractCaptionTracksFromHtml(html);
    console.log(`[transcript] Strategy 2 (${page.label}): found ${tracks.length} caption tracks`);

    if (tracks.length === 0) continue;

    const languages = tracks.map(
      (t) => `${t.languageCode}${t.kind === "asr" ? "(auto)" : ""}`
    );
    console.log(`[transcript] Strategy 2 (${page.label}): languages=[${languages.join(", ")}]`);

    const chosen = pickBestTrack(tracks);
    if (!chosen) continue;

    const trackLabel = chosen.name?.simpleText ?? chosen.languageCode;
    console.log(`[transcript] Strategy 2 (${page.label}): chose track: ${trackLabel} (lang=${chosen.languageCode}, kind=${chosen.kind ?? "manual"})`);

    const baseUrl = chosen.baseUrl.replace(/\\u0026/g, "&");
    const urls = [baseUrl + "&fmt=srv3", baseUrl];

    for (const url of urls) {
      try {
        console.log(`[transcript] Strategy 2 (${page.label}): fetching transcript from ${url.substring(0, 120)}...`);
        const tResp = await fetch(url, {
          headers: { "User-Agent": USER_AGENT },
        });
        if (!tResp.ok) {
          console.log(`[transcript] Strategy 2 (${page.label}): transcript endpoint returned ${tResp.status}`);
          continue;
        }
        const xml = await tResp.text();
        const lines = extractTextLines(xml);
        if (lines.length > 0) {
          console.log(`[transcript] Strategy 2 (${page.label}): extracted ${lines.length} text lines`);
          return {
            transcript: lines.join("\n"),
            strategy: `page_scrape_${page.label}`,
            language: chosen.languageCode,
            trackCount: tracks.length,
          };
        }
      } catch (err) {
        console.log(`[transcript] Strategy 2 (${page.label}): fetch error: ${err}`);
      }
    }

    console.log(`[transcript] Strategy 2 (${page.label}): tracks found but content extraction failed`);
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Strategy 3: YouTube InnerTube API                                  */
/* ------------------------------------------------------------------ */

const INNERTUBE_API_KEY = Deno.env.get("INNERTUBE_API_KEY")?.trim() || "";

function buildInnertubeClients() {
  if (!INNERTUBE_API_KEY) return [];

  // Multiple client configs to try — embedded and web clients.
  return [
    {
      label: "EMBEDDED",
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      apiUrl: `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
      userAgent: USER_AGENT,
    },
    {
      label: "WEB",
      clientName: "WEB",
      clientVersion: "2.20240313.05.00",
      apiUrl: `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`,
      userAgent: USER_AGENT,
    },
  ];
}

async function tryInnertubeApi(videoId: string): Promise<StrategyResult | null> {
  const clients = buildInnertubeClients();
  if (clients.length === 0) {
    console.log("[transcript] Strategy 3: INNERTUBE_API_KEY is not configured; skipping");
    return null;
  }

  for (const client of clients) {
    console.log(`[transcript] Strategy 3 (${client.label}): calling InnerTube player API for videoId=${videoId}`);

    try {
      const resp = await fetch(client.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": client.userAgent,
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
        console.log(`[transcript] Strategy 3 (${client.label}): InnerTube returned ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const tracks: CaptionTrack[] =
        data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      console.log(`[transcript] Strategy 3 (${client.label}): found ${tracks.length} caption tracks`);

      if (tracks.length === 0) continue;

      const languages = tracks.map(
        (t: CaptionTrack) => `${t.languageCode}${t.kind === "asr" ? "(auto)" : ""}`
      );
      console.log(`[transcript] Strategy 3 (${client.label}): languages=[${languages.join(", ")}]`);

      const chosen = pickBestTrack(tracks);
      if (!chosen) continue;

      const trackLabel = chosen.name?.simpleText ?? chosen.languageCode;
      console.log(`[transcript] Strategy 3 (${client.label}): chose track: ${trackLabel} (lang=${chosen.languageCode}, kind=${chosen.kind ?? "manual"})`);

      const baseUrl = chosen.baseUrl.replace(/\\u0026/g, "&");
      const captionUrls = [baseUrl + "&fmt=srv3", baseUrl];

      for (const captionUrl of captionUrls) {
        try {
          console.log(`[transcript] Strategy 3 (${client.label}): fetching transcript from ${captionUrl.substring(0, 120)}...`);
          const tResp = await fetch(captionUrl, {
            headers: { "User-Agent": client.userAgent },
          });
          if (!tResp.ok) {
            console.log(`[transcript] Strategy 3 (${client.label}): transcript endpoint returned ${tResp.status}`);
            continue;
          }
          const xml = await tResp.text();
          const lines = extractTextLines(xml);
          if (lines.length > 0) {
            console.log(`[transcript] Strategy 3 (${client.label}): extracted ${lines.length} text lines`);
            return {
              transcript: lines.join("\n"),
              strategy: `innertube_${client.label.toLowerCase()}`,
              language: chosen.languageCode,
              trackCount: tracks.length,
            };
          }
        } catch (err) {
          console.log(`[transcript] Strategy 3 (${client.label}): fetch error: ${err}`);
        }
      }

      console.log(`[transcript] Strategy 3 (${client.label}): tracks found but content extraction failed`);
    } catch (err) {
      console.log(`[transcript] Strategy 3 (${client.label}): InnerTube error: ${err}`);
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function fetchTranscriptForVideo(videoId: string): Promise<string> {
  console.log(`[transcript] Starting transcript fetch for videoId=${videoId}`);

  // Strategy 1: Legacy API (fast)
  const legacy = await tryLegacyTimedtextApi(videoId);
  if (legacy) {
    console.log(`[transcript] Success via ${legacy.strategy}, language=${legacy.language}, length=${legacy.transcript.length}`);
    return legacy.transcript;
  }

  // Strategy 2: Watch page scrape
  const scraped = await tryWatchPageScrape(videoId);
  if (scraped) {
    console.log(`[transcript] Success via ${scraped.strategy}, language=${scraped.language}, trackCount=${scraped.trackCount}, length=${scraped.transcript.length}`);
    return scraped.transcript;
  }

  // Strategy 3: InnerTube API (bypasses web page 429 rate limits)
  const innertube = await tryInnertubeApi(videoId);
  if (innertube) {
    console.log(`[transcript] Success via ${innertube.strategy}, language=${innertube.language}, trackCount=${innertube.trackCount}, length=${innertube.transcript.length}`);
    return innertube.transcript;
  }

  throw new Error("No transcript tracks available for this video");
}
