// @ts-nocheck
import pdfParse from "https://esm.sh/pdf-parse@1.1.1?target=es2022";
import { Buffer } from "node:buffer";
import mammoth from "https://esm.sh/mammoth@1.8.0?target=es2022";

// ─── Windows-1251 Decoder (Serbian Cyrillic) ───────────────────────────

const WIN1251_MAP: string[] = (() => {
  const map: string[] = new Array(256);
  for (let i = 0; i < 128; i++) map[i] = String.fromCharCode(i);
  const upper = [
    0x0402,0x0403,0x201A,0x0453,0x201E,0x2026,0x2020,0x2021,0x20AC,0x2030,0x0409,0x2039,0x040A,0x040C,0x040B,0x040F,
    0x0452,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0xFFFD,0x2122,0x0459,0x203A,0x045A,0x045C,0x045B,0x045F,
    0x00A0,0x040E,0x045E,0x0408,0x00A4,0x0490,0x00A6,0x00A7,0x0401,0x00A9,0x0404,0x00AB,0x00AC,0x00AD,0x00AE,0x0407,
    0x00B0,0x00B1,0x0406,0x0456,0x0491,0x00B5,0x00B6,0x00B7,0x0451,0x2116,0x0454,0x00BB,0x0458,0x0405,0x0455,0x0457,
    0x0410,0x0411,0x0412,0x0413,0x0414,0x0415,0x0416,0x0417,0x0418,0x0419,0x041A,0x041B,0x041C,0x041D,0x041E,0x041F,
    0x0420,0x0421,0x0422,0x0423,0x0424,0x0425,0x0426,0x0427,0x0428,0x0429,0x042A,0x042B,0x042C,0x042D,0x042E,0x042F,
    0x0430,0x0431,0x0432,0x0433,0x0434,0x0435,0x0436,0x0437,0x0438,0x0439,0x043A,0x043B,0x043C,0x043D,0x043E,0x043F,
    0x0440,0x0441,0x0442,0x0443,0x0444,0x0445,0x0446,0x0447,0x0448,0x0449,0x044A,0x044B,0x044C,0x044D,0x044E,0x044F,
  ];
  for (let i = 0; i < 128; i++) map[128 + i] = String.fromCharCode(upper[i]);
  return map;
})();

function decodeWindows1251(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    result += WIN1251_MAP[bytes[i]];
  }
  return result;
}

// ─── DOCX ZIP Extraction ───────────────────────────────────────────────

async function extractDocxEntry(zipBytes: Uint8Array, targetPath: string): Promise<string | null> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

  let eocdOffset = -1;
  for (let i = zipBytes.length - 22; i >= Math.max(0, zipBytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    console.log("[docx-zip] EOCD not found");
    return null;
  }

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdEntries = view.getUint16(eocdOffset + 10, true);

  let offset = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (offset + 46 > zipBytes.length) break;
    if (view.getUint32(offset, true) !== 0x02014b50) break;

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const fileName = new TextDecoder().decode(zipBytes.subarray(offset + 46, offset + 46 + fileNameLen));

    if (fileName === targetPath) {
      const lfhOffset = localHeaderOffset;
      if (lfhOffset + 30 > zipBytes.length) return null;
      const lfhFileNameLen = view.getUint16(lfhOffset + 26, true);
      const lfhExtraLen = view.getUint16(lfhOffset + 28, true);
      const dataStart = lfhOffset + 30 + lfhFileNameLen + lfhExtraLen;

      const compressedData = zipBytes.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return new TextDecoder("utf-8").decode(compressedData);
      } else if (compressionMethod === 8) {
        try {
          const ds = new DecompressionStream("deflate-raw" as CompressionFormat);
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();

          // Use only the entry payload bytes. Passing the backing ArrayBuffer can
          // include unrelated ZIP bytes and cause decompression to hang.
          const input = compressedData.slice();

          const chunks: Uint8Array[] = [];
          const readAll = (async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          })();

          const inflateWithTimeout = Promise.race([
            (async () => {
              await writer.write(input);
              await writer.close();
              await readAll;
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("DOCX inflate timeout")), 8000)
            ),
          ]);

          await inflateWithTimeout;

          const totalLen = chunks.reduce((s, c) => s + c.length, 0);
          const result = new Uint8Array(totalLen);
          let pos = 0;
          for (const chunk of chunks) {
            result.set(chunk, pos);
            pos += chunk.length;
          }
          return new TextDecoder("utf-8").decode(result);
        } catch (e) {
          console.warn(`[docx-zip] Deflate failed for ${targetPath}: ${e}`);
          return null;
        }
      } else {
        console.log(`[docx-zip] Unsupported compression method: ${compressionMethod}`);
        return null;
      }
    }

    offset += 46 + fileNameLen + extraLen + commentLen;
  }

  console.log(`[docx-zip] Entry "${targetPath}" not found among ${cdEntries} entries`);
  return null;
}

// ─── Legacy .doc Extraction ────────────────────────────────────────────

function isOLE2(bytes: Uint8Array): boolean {
  return bytes.length >= 8 &&
    bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0 &&
    bytes[4] === 0xA1 && bytes[5] === 0xB2 && bytes[6] === 0x1A && bytes[7] === 0xE1;
}

function extractUTF16LEText(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let currentChunk = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (
      (code >= 0x20 && code <= 0x7E) ||
      (code >= 0x00A0 && code <= 0x024F) ||
      (code >= 0x0400 && code <= 0x04FF) ||
      (code >= 0x0600 && code <= 0x06FF) ||
      (code >= 0x4E00 && code <= 0x9FFF) ||
      code === 0x0D || code === 0x0A || code === 0x09
    ) {
      currentChunk += String.fromCharCode(code);
    } else {
      if (currentChunk.trim().length >= 5) chunks.push(currentChunk.trim());
      currentChunk = "";
    }
  }
  if (currentChunk.trim().length >= 5) chunks.push(currentChunk.trim());
  return chunks.join(" ");
}

function extractCleanWin1251(bytes: Uint8Array): string {
  const decoded = decodeWindows1251(bytes);
  return extractReadableSequences(decoded);
}

function extractReadableSequences(raw: string): string {
  const sequences: string[] = [];
  let current = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (
      (c >= 0x20 && c <= 0x7E) ||
      (c >= 0x00A0 && c <= 0x024F) ||
      (c >= 0x0400 && c <= 0x04FF) ||
      (c >= 0x0600 && c <= 0x06FF) ||
      (c >= 0x4E00 && c <= 0x9FFF) ||
      c === 0x0A || c === 0x0D || c === 0x09
    ) {
      current += raw[i];
    } else {
      if (current.trim().length >= 4) sequences.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length >= 4) sequences.push(current.trim());

  return sequences
    .filter((s) => {
      const letterCount = (s.match(/[\p{L}\p{N}]/gu) || []).length;
      return letterCount / s.length > 0.3;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100000);
}

function extractDocText(bytes: Uint8Array): { text: string; method: string; encoding: string } {
  const utf16Text = extractUTF16LEText(bytes);
  const utf16Quality = assessTextQuality(utf16Text);

  const win1251Text = extractCleanWin1251(bytes);
  const win1251Quality = assessTextQuality(win1251Text);

  const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const cleanUtf8 = extractReadableSequences(utf8Text);
  const utf8Quality = assessTextQuality(cleanUtf8);

  const candidates = [
    { text: utf16Text, quality: utf16Quality, method: "doc_utf16le", encoding: "utf-16le" },
    { text: win1251Text, quality: win1251Quality, method: "doc_win1251", encoding: "windows-1251" },
    { text: cleanUtf8, quality: utf8Quality, method: "doc_utf8_fallback", encoding: "utf-8" },
  ];

  candidates.sort((a, b) => {
    if (a.quality.readable !== b.quality.readable) return a.quality.readable ? -1 : 1;
    if (a.quality.score !== b.quality.score) return b.quality.score - a.quality.score;
    return b.quality.wordCount - a.quality.wordCount;
  });

  const best = candidates[0];
  return { text: best.text, method: best.method, encoding: best.encoding };
}

async function extractDocTextWithWordExtractor(
  bytes: Uint8Array
): Promise<{ text: string; method: string; encoding: string; quality: TextQuality } | null> {
  let tmpPath: string | null = null;
  try {
    const mod = await import("https://esm.sh/word-extractor@0.3.0?target=es2022");
    const WordExtractorCtor = (mod as any).default ?? mod;
    const extractor = new WordExtractorCtor();

    tmpPath = await Deno.makeTempFile({ suffix: ".doc" });
    await Deno.writeFile(tmpPath, bytes);

    const extracted = await extractor.extract(tmpPath);
    const body = typeof extracted?.getBody === "function"
      ? extracted.getBody()
      : (extracted?.body ?? "");

    const text = String(body || "").trim();
    if (!text) return null;

    return {
      text,
      method: "word-extractor",
      encoding: "binary-doc",
      quality: assessTextQuality(text),
    };
  } catch (e) {
    console.warn(`[doc-extraction] word-extractor failed: ${e}`);
    return null;
  } finally {
    if (tmpPath) {
      await Deno.remove(tmpPath).catch(() => {});
    }
  }
}

// ─── Structural / XML Noise Filtering ──────────────────────────────────

const STRUCTURAL_PATTERNS = [
  /\[Content_Types\]\.xml/gi,
  /word\/document\.xml/gi,
  /word\/styles\.xml/gi,
  /word\/settings\.xml/gi,
  /word\/fontTable\.xml/gi,
  /word\/theme\//gi,
  /word\/_rels\//gi,
  /customXml\//gi,
  /docProps\//gi,
  /\bxmlns[:=]/gi,
  /<\/?[a-z]+:[a-z]+[^>]*>/gi,
  /PK\x03\x04/g,
  /Content-Type:\s*application\//gi,
  /urn:schemas-microsoft-com/gi,
  /http:\/\/schemas\.(openxmlformats|microsoft)\.org/gi,
  /\brels\/\w+/gi,
  /w:rsid\w*="[^"]*"/gi,
  /mc:Ignorable/gi,
  /w14:|w15:|wps:|wpc:|wpg:/g,
];

const STRUCTURAL_KEYWORDS = new Set([
  "content_types", "rels", "docprops", "customxml", "fonttable",
  "settings", "styles", "theme", "numbering", "footnotes",
  "endnotes", "header", "footer", "webextensions", "bibliography",
  "xmlnamespacuri", "pkzipcontent", "relationship", "override",
  "partname", "contenttype",
]);

export function computeStructuralNoiseRatio(text: string): number {
  if (!text || text.length < 50) return 0;
  const sample = text.slice(0, 20000);
  let noiseChars = 0;
  for (const pat of STRUCTURAL_PATTERNS) {
    const matches = sample.match(pat);
    if (matches) {
      for (const m of matches) noiseChars += m.length;
    }
  }
  return noiseChars / sample.length;
}

export function filterStructuralNoise(text: string): string {
  if (!text) return text;

  const blocks = text.split(/\n{2,}|\r\n\r\n/);
  const cleanBlocks: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.length < 3) continue;

    let structuralHits = 0;
    for (const pat of STRUCTURAL_PATTERNS) {
      if (pat.test(trimmed)) structuralHits++;
      pat.lastIndex = 0;
    }
    if (structuralHits >= 3) continue;

    const lowerWords = trimmed.toLowerCase().split(/\s+/);
    const structKeywordCount = lowerWords.filter((w) => STRUCTURAL_KEYWORDS.has(w.replace(/[^a-z]/g, ""))).length;
    if (lowerWords.length > 0 && structKeywordCount / lowerWords.length > 0.3) continue;

    if (trimmed.length < 20 && (trimmed.includes("/") || trimmed.includes("<") || trimmed.includes("xmlns"))) continue;

    cleanBlocks.push(trimmed);
  }

  return cleanBlocks.join("\n\n").trim();
}

// ─── Script Detection ──────────────────────────────────────────────────

export interface ScriptInfo {
  primary: "latin" | "cyrillic" | "arabic" | "cjk" | "mixed" | "unknown";
  latinRatio: number;
  cyrillicRatio: number;
  arabicRatio: number;
  cjkRatio: number;
}

export function detectScript(text: string): ScriptInfo {
  if (!text || text.trim().length < 10) {
    return { primary: "unknown", latinRatio: 0, cyrillicRatio: 0, arabicRatio: 0, cjkRatio: 0 };
  }

  const sample = text.slice(0, 10000);
  const letters = sample.match(/\p{L}/gu) || [];
  const total = letters.length;
  if (total === 0) {
    return { primary: "unknown", latinRatio: 0, cyrillicRatio: 0, arabicRatio: 0, cjkRatio: 0 };
  }

  const latinCount = (sample.match(/[\u0041-\u005A\u0061-\u007A\u00C0-\u024F\u0100-\u017F]/gu) || []).length;
  const cyrillicCount = (sample.match(/[\u0400-\u04FF]/gu) || []).length;
  const arabicCount = (sample.match(/[\u0600-\u06FF]/gu) || []).length;
  const cjkCount = (sample.match(/[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/gu) || []).length;

  const latinRatio = latinCount / total;
  const cyrillicRatio = cyrillicCount / total;
  const arabicRatio = arabicCount / total;
  const cjkRatio = cjkCount / total;

  let primary: ScriptInfo["primary"] = "unknown";
  const max = Math.max(latinRatio, cyrillicRatio, arabicRatio, cjkRatio);
  if (max < 0.3) primary = "mixed";
  else if (max === cyrillicRatio) primary = "cyrillic";
  else if (max === arabicRatio) primary = "arabic";
  else if (max === cjkRatio) primary = "cjk";
  else primary = "latin";

  return {
    primary,
    latinRatio: Math.round(latinRatio * 100) / 100,
    cyrillicRatio: Math.round(cyrillicRatio * 100) / 100,
    arabicRatio: Math.round(arabicRatio * 100) / 100,
    cjkRatio: Math.round(cjkRatio * 100) / 100,
  };
}

// ─── Text Quality Assessment ───────────────────────────────────────────

export interface TextQuality {
  readable: boolean;
  score: number;
  wordCount: number;
  readableCharRatio: number;
  pdfSyntaxRatio: number;
  structuralNoiseRatio: number;
  reason: string;
}

export function assessTextQuality(text: string): TextQuality {
  if (!text || text.trim().length < 20) {
    return { readable: false, score: 0, wordCount: 0, readableCharRatio: 0, pdfSyntaxRatio: 0, structuralNoiseRatio: 0, reason: "too_short" };
  }

  const sample = text.slice(0, 10000);
  const totalChars = sample.length;

  const readableChars = (sample.match(/[\p{L}\p{N}\p{P}\p{Z}\p{S}]/gu) || []).length;
  const readableCharRatio = readableChars / totalChars;

  const pdfSyntaxTokens = (sample.match(/\b(obj|endobj|stream|endstream|FlateDecode|xref|trailer|startxref|\/Type|\/Font|\/Page|\/Length|\/Filter)\b/gi) || []).length;
  const words = sample.split(/\s+/).filter(Boolean);
  const pdfSyntaxRatio = words.length > 0 ? pdfSyntaxTokens / words.length : 1;

  const structuralNoiseRatio = computeStructuralNoiseRatio(sample);

  const realWords = (sample.match(/\p{L}{3,}/gu) || []).length;

  let score = 0;
  let reason = "ok";

  if (readableCharRatio < 0.3) {
    reason = "low_readable_char_ratio";
  } else if (pdfSyntaxRatio > 0.15) {
    reason = "high_pdf_syntax_ratio";
  } else if (structuralNoiseRatio > 0.4) {
    reason = "high_structural_noise";
  } else if (realWords < 5) {
    reason = "too_few_real_words";
  } else {
    score = Math.min(1, readableCharRatio * (1 - pdfSyntaxRatio) * (1 - structuralNoiseRatio) * Math.min(realWords / 50, 1));
  }

  return {
    readable: score > 0.15,
    score,
    wordCount: realWords,
    readableCharRatio: Math.round(readableCharRatio * 100) / 100,
    pdfSyntaxRatio: Math.round(pdfSyntaxRatio * 100) / 100,
    structuralNoiseRatio: Math.round(structuralNoiseRatio * 100) / 100,
    reason,
  };
}

// ─── Language Detection ────────────────────────────────────────────────

export interface LanguageResult {
  language: string;
  script: string;
  confidence: number;
}

const SR_LATIN_CHARS = /[čćžšđČĆŽŠĐ]/g;

const SR_LATIN_WORDS = new Set([
  "je", "i", "u", "na", "da", "se", "su", "za", "sa", "od", "kao",
  "ili", "ali", "koji", "koja", "koje", "koji", "iz", "po", "do",
  "ne", "će", "bi", "bio", "bila", "bilo", "su", "sve", "svi",
  "ima", "može", "tako", "samo", "kad", "ako", "što", "šta", "već",
  "još", "između", "preko", "prema", "kroz", "bez", "oko", "pred",
  "pod", "nad", "zbog", "prema", "prema", "dok", "jer", "nego",
  "niti", "ni", "neka", "ova", "taj", "tog", "tom", "tim",
  "ovaj", "ona", "ono", "oni", "one", "ove", "ovi", "toga",
  "tome", "ovom", "onog", "onom", "svaki", "svaka", "svako",
  "jedan", "jedna", "jedno", "jednog", "jednom", "jednoj",
  "biti", "imati", "trebati", "moći", "znati", "hteti",
  "godine", "godina", "dana", "dan", "rad", "rada", "član",
  "člana", "zakon", "zakona", "pravo", "prava", "strana",
  "strane", "republika", "srbija", "srbije", "beograd",
  "takođe", "odnosno", "naime", "dakle", "zatim", "potom",
  "međutim", "ipak", "upravo", "ukoliko", "uslovi",
]);

const SR_CYRILLIC_WORDS = new Set([
  "је", "и", "у", "на", "да", "се", "су", "за", "са", "од", "као",
  "или", "али", "који", "која", "које", "из", "по", "до",
  "не", "ће", "би", "био", "била", "било", "све", "сви",
  "има", "може", "тако", "само", "кад", "ако", "што", "шта", "већ",
  "још", "између", "преко", "према", "кроз", "без", "око", "пред",
  "под", "над", "због", "док", "јер", "него",
  "нити", "ни", "нека", "ова", "тај", "тог", "том", "тим",
  "овај", "она", "оно", "они", "оне", "ове", "ови", "тога",
  "томе", "овом", "оног", "оном", "сваки", "свака", "свако",
  "један", "једна", "једно", "једног", "једном", "једној",
  "бити", "имати", "требати", "моћи", "знати", "хтети",
  "године", "година", "дана", "дан", "рад", "рада", "члан",
  "члана", "закон", "закона", "право", "права", "страна",
  "стране", "република", "србија", "србије", "београд",
  "такође", "односно", "наиме", "дакле", "затим", "потом",
  "међутим", "ипак", "управо", "уколико", "услови",
]);

export function detectLanguage(text: string): LanguageResult {
  if (!text || text.trim().length < 20) return { language: "unknown", script: "unknown", confidence: 0 };

  const cleaned = filterStructuralNoise(text);
  const sample = (cleaned.length > 100 ? cleaned : text).slice(0, 8000).toLowerCase();

  const scriptInfo = detectScript(sample);

  const srLatinDiacritics = (sample.match(SR_LATIN_CHARS) || []).length;

  const words = sample.split(/\s+/).filter((w) => w.length >= 2);
  const totalWords = words.length;
  if (totalWords === 0) return { language: "unknown", script: scriptInfo.primary, confidence: 0 };

  if (scriptInfo.cyrillicRatio > 0.2) {
    let srCyrScore = 0;
    for (const w of words) {
      if (SR_CYRILLIC_WORDS.has(w)) srCyrScore++;
    }
    const srCyrRatio = srCyrScore / totalWords;
    if (srCyrRatio > 0.05 || scriptInfo.cyrillicRatio > 0.4) {
      return {
        language: "sr",
        script: "cyrillic",
        confidence: Math.min(0.95, 0.5 + srCyrRatio * 5 + scriptInfo.cyrillicRatio),
      };
    }
    return { language: "sr", script: "cyrillic", confidence: 0.5 };
  }

  let srLatinScore = 0;
  for (const w of words) {
    if (SR_LATIN_WORDS.has(w)) srLatinScore++;
  }
  const srLatinRatio = srLatinScore / totalWords;
  const diacriticDensity = srLatinDiacritics / sample.length;

  if (srLatinRatio > 0.08 || (srLatinRatio > 0.03 && diacriticDensity > 0.005)) {
    return {
      language: "sr",
      script: "latin",
      confidence: Math.min(0.95, 0.4 + srLatinRatio * 5 + diacriticDensity * 50),
    };
  }
  if (diacriticDensity > 0.01) {
    return {
      language: "sr",
      script: "latin",
      confidence: Math.min(0.7, 0.3 + diacriticDensity * 30),
    };
  }

  const enWords = new Set(["the", "and", "is", "in", "to", "of", "a", "for", "that", "it", "with", "on", "as", "are", "was", "be", "this", "have", "from", "or", "an", "but", "not", "by", "at", "they", "which", "do", "their", "if", "will", "each", "about", "how", "up", "out", "them", "then", "she", "many", "some", "so", "these", "would", "other"]);
  const deWords = new Set(["der", "die", "und", "ist", "von", "den", "das", "mit", "auf", "für", "ein", "eine", "des", "dem", "nicht", "sich", "auch", "als", "noch", "nach", "bei", "aus", "wie", "aber", "wenn"]);
  const frWords = new Set(["le", "la", "les", "de", "des", "du", "un", "une", "et", "est", "en", "que", "qui", "dans", "pour", "pas", "sur", "ce", "par", "sont", "avec", "au", "aux", "mais", "ou", "ne"]);
  const esWords = new Set(["el", "la", "los", "las", "de", "en", "un", "una", "que", "es", "por", "con", "del", "para", "al", "se", "no", "su", "más", "como", "pero", "sus", "le", "ya", "este"]);

  let enScore = 0, deScore = 0, frScore = 0, esScore = 0;
  for (const w of words) {
    if (enWords.has(w)) enScore++;
    if (deWords.has(w)) deScore++;
    if (frWords.has(w)) frScore++;
    if (esWords.has(w)) esScore++;
  }

  const maxScore = Math.max(enScore, deScore, frScore, esScore);
  if (maxScore < 3) return { language: "en", script: scriptInfo.primary, confidence: 0.3 };
  if (maxScore === enScore) return { language: "en", script: "latin", confidence: Math.min(enScore / totalWords * 10, 0.95) };
  if (maxScore === deScore) return { language: "de", script: "latin", confidence: Math.min(deScore / totalWords * 10, 0.9) };
  if (maxScore === frScore) return { language: "fr", script: "latin", confidence: Math.min(frScore / totalWords * 10, 0.9) };
  if (maxScore === esScore) return { language: "es", script: "latin", confidence: Math.min(esScore / totalWords * 10, 0.9) };
  return { language: "en", script: scriptInfo.primary, confidence: 0.3 };
}

export function countStats(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return {
    word_count: words.length,
    char_count: text.length,
    line_count: text.split("\n").length,
  };
}

export function normalizeForSearch(text: string, fileName: string, summary?: string): string {
  const parts = [fileName, summary || "", text].filter(Boolean);
  return parts
    .join(" ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ExtractTextResult {
  text: string;
  method: string;
  encoding?: string;
  quality: TextQuality;
}

export async function extractText(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string
): Promise<ExtractTextResult> {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  if (mimeType.startsWith("text/") || ["txt", "md", "csv", "rtf"].includes(ext)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { text, method: "plaintext", encoding: "utf-8", quality: assessTextQuality(text) };
  }

  if (ext === "pdf" || mimeType === "application/pdf") {
    try {
      const result = await pdfParse(Buffer.from(bytes));
      const text = String(result?.text || "");
      const quality = assessTextQuality(text);
      if (quality.readable) {
        return { text, method: "pdf-parse", quality };
      }
      return { text, method: "pdf-parse_low_quality", quality };
    } catch (e) {
      console.warn("pdf-parse extraction failed:", e);
      return { text: "", method: "pdf-parse_error", quality: assessTextQuality("") };
    }
  }

  if (ext === "doc" || mimeType === "application/msword") {
    const extractedByWordExtractor = await extractDocTextWithWordExtractor(bytes);
    if (extractedByWordExtractor && (extractedByWordExtractor.quality.readable || extractedByWordExtractor.text.length > 0)) {
      console.log(`[doc-extraction] method=word-extractor, encoding=binary-doc, textLen=${extractedByWordExtractor.text.length}, isOLE2=${isOLE2(bytes)}`);
      return extractedByWordExtractor;
    }

    const result = extractDocText(bytes);
    const quality = assessTextQuality(result.text);
    console.log(`[doc-extraction] method=${result.method}, encoding=${result.encoding}, textLen=${result.text.length}, isOLE2=${isOLE2(bytes)}`);
    return { text: result.text, method: result.method, encoding: result.encoding, quality };
  }

  if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
      const text = String(result.value || "").trim();
      const messageCount = Array.isArray(result.messages) ? result.messages.length : 0;
      console.log(`[docx-extraction] mammoth completed, messages=${messageCount}, textLen=${text.length}`);
      const quality = assessTextQuality(text);
      if (quality.readable || text.length > 0) {
        return { text, method: "mammoth", encoding: "utf-8", quality };
      }
    } catch (e) {
      console.warn(`[docx-extraction] mammoth failed: ${e}`);
    }

    // Fallback only if Mammoth fails or returns no text.
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const matches = raw.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    const parts: string[] = [];
    for (const m of matches) parts.push(m[1]);
    const text = parts.join(" ");
    return { text, method: "docx_xml_fallback", encoding: "utf-8", quality: assessTextQuality(text) };
  }

  if (["xlsx", "xls"].includes(ext)) {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const matches = raw.matchAll(/<t[^>]*>([^<]*)<\/t>/g);
    const parts: string[] = [];
    for (const m of matches) parts.push(m[1]);
    const text = parts.length > 0
      ? parts.join(" ")
      : raw.replace(/[^ -~\n\r\t]/g, " ").replace(/\s+/g, " ").slice(0, 50000);
    return { text, method: "spreadsheet_xml", quality: assessTextQuality(text) };
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, 50000);
  return { text, method: "fallback_decode", quality: assessTextQuality(text) };
}

export function categorizeFile(fileType: string): string {
  switch (fileType) {
    case "pdf": return "pdf";
    case "doc":
    case "docx": return "word";
    case "xls":
    case "xlsx":
    case "csv": return "spreadsheet";
    case "txt": return "text";
    case "md": return "markdown";
    case "rtf": return "rich_text";
    default: return "other";
  }
}
