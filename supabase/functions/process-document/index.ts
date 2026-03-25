import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { extractText as extractPdfText } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  // Parse ZIP central directory to find the target entry
  // ZIP end-of-central-directory is at the end of the file
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  
  // Find End of Central Directory record (signature 0x06054b50)
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
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const fileName = new TextDecoder().decode(zipBytes.subarray(offset + 46, offset + 46 + fileNameLen));
    
    if (fileName === targetPath) {
      // Read from local file header
      const lfhOffset = localHeaderOffset;
      if (lfhOffset + 30 > zipBytes.length) return null;
      const lfhFileNameLen = view.getUint16(lfhOffset + 26, true);
      const lfhExtraLen = view.getUint16(lfhOffset + 28, true);
      const dataStart = lfhOffset + 30 + lfhFileNameLen + lfhExtraLen;

      const compressedData = zipBytes.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        // Stored (no compression)
        return new TextDecoder("utf-8").decode(compressedData);
      } else if (compressionMethod === 8) {
        // Deflate
        try {
          const ds = new DecompressionStream("deflate-raw" as CompressionFormat);
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();
          
          const chunks: Uint8Array[] = [];
          const readAll = (async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
          })();
          
          await writer.write(new Uint8Array(compressedData.buffer));
          await writer.close();
          await readAll;
          
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
      if (currentChunk.trim().length >= 5) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = "";
    }
  }
  if (currentChunk.trim().length >= 5) chunks.push(currentChunk.trim());
  return chunks.join(" ");
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
    .filter(s => {
      const letterCount = (s.match(/[\p{L}\p{N}]/gu) || []).length;
      return letterCount / s.length > 0.3;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100000);
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

function computeStructuralNoiseRatio(text: string): number {
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

function filterStructuralNoise(text: string): string {
  if (!text) return text;
  
  // Split into paragraphs/blocks
  const blocks = text.split(/\n{2,}|\r\n\r\n/);
  const cleanBlocks: string[] = [];
  
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.length < 3) continue;
    
    // Skip blocks that are mostly XML/structural
    let structuralHits = 0;
    for (const pat of STRUCTURAL_PATTERNS) {
      if (pat.test(trimmed)) structuralHits++;
      pat.lastIndex = 0; // reset regex state
    }
    if (structuralHits >= 3) continue;
    
    // Skip blocks with structural keywords dominating
    const lowerWords = trimmed.toLowerCase().split(/\s+/);
    const structKeywordCount = lowerWords.filter(w => STRUCTURAL_KEYWORDS.has(w.replace(/[^a-z]/g, ''))).length;
    if (lowerWords.length > 0 && structKeywordCount / lowerWords.length > 0.3) continue;
    
    // Skip very short blocks that look like paths or XML fragments
    if (trimmed.length < 20 && (trimmed.includes('/') || trimmed.includes('<') || trimmed.includes('xmlns'))) continue;
    
    cleanBlocks.push(trimmed);
  }
  
  return cleanBlocks.join("\n\n").trim();
}

// ─── Script Detection ──────────────────────────────────────────────────

interface ScriptInfo {
  primary: "latin" | "cyrillic" | "arabic" | "cjk" | "mixed" | "unknown";
  latinRatio: number;
  cyrillicRatio: number;
  arabicRatio: number;
  cjkRatio: number;
}

function detectScript(text: string): ScriptInfo {
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

interface TextQuality {
  readable: boolean;
  score: number;
  wordCount: number;
  readableCharRatio: number;
  pdfSyntaxRatio: number;
  structuralNoiseRatio: number;
  reason: string;
}

function assessTextQuality(text: string): TextQuality {
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

interface LanguageResult {
  language: string;
  script: string;
  confidence: number;
}

// Serbian Latin-specific diacritics
const SR_LATIN_CHARS = /[čćžšđČĆŽŠĐ]/g;

// Common Serbian words (Latin) — high-frequency function words
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

// Serbian Cyrillic common words
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

function detectLanguage(text: string): LanguageResult {
  if (!text || text.trim().length < 20) return { language: "unknown", script: "unknown", confidence: 0 };

  // Use body text, skip structural noise
  const cleaned = filterStructuralNoise(text);
  const sample = (cleaned.length > 100 ? cleaned : text).slice(0, 8000).toLowerCase();

  const scriptInfo = detectScript(sample);

  // Count Serbian-specific Latin diacritics
  const srLatinDiacritics = (sample.match(SR_LATIN_CHARS) || []).length;

  const words = sample.split(/\s+/).filter(w => w.length >= 2);
  const totalWords = words.length;
  if (totalWords === 0) return { language: "unknown", script: scriptInfo.primary, confidence: 0 };

  // ── Cyrillic-dominant text ──
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
    // Generic Cyrillic but not clearly Serbian — could be Russian, etc.
    return { language: "sr", script: "cyrillic", confidence: 0.5 };
  }

  // ── Latin-dominant text — check Serbian Latin ──
  let srLatinScore = 0;
  for (const w of words) {
    if (SR_LATIN_WORDS.has(w)) srLatinScore++;
  }
  const srLatinRatio = srLatinScore / totalWords;
  const diacriticDensity = srLatinDiacritics / sample.length;

  // Strong Serbian Latin signals: diacritics + common words
  if (srLatinRatio > 0.08 || (srLatinRatio > 0.03 && diacriticDensity > 0.005)) {
    return {
      language: "sr",
      script: "latin",
      confidence: Math.min(0.95, 0.4 + srLatinRatio * 5 + diacriticDensity * 50),
    };
  }
  // Diacritics alone as a weaker signal
  if (diacriticDensity > 0.01) {
    return {
      language: "sr",
      script: "latin",
      confidence: Math.min(0.7, 0.3 + diacriticDensity * 30),
    };
  }

  // ── Other Latin-script languages ──
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

// ─── Helpers ───────────────────────────────────────────────────────────

function countStats(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return { word_count: words.length, char_count: text.length, line_count: text.split("\n").length };
}

function normalizeForSearch(text: string, fileName: string, summary?: string): string {
  const parts = [fileName, summary || "", text].filter(Boolean);
  return parts.join(" ").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

async function extractText(bytes: Uint8Array, mimeType: string, fileName: string): Promise<{ text: string; method: string; encoding?: string; quality: TextQuality }> {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  // Plain text formats
  if (mimeType.startsWith("text/") || ["txt", "md", "csv", "rtf"].includes(ext)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { text, method: "plaintext", encoding: "utf-8", quality: assessTextQuality(text) };
  }

  // PDF
  if (ext === "pdf" || mimeType === "application/pdf") {
    try {
      const result = await extractPdfText(bytes, { mergePages: true });
      const text = result.text || "";
      const quality = assessTextQuality(text);
      if (quality.readable) {
        return { text, method: "unpdf", quality };
      }
      return { text, method: "unpdf_low_quality", quality };
    } catch (e) {
      console.warn("unpdf extraction failed:", e);
      return { text: "", method: "unpdf_error", quality: assessTextQuality("") };
    }
  }

  // Legacy .doc
  if (ext === "doc" || mimeType === "application/msword") {
    const result = extractDocText(bytes);
    const quality = assessTextQuality(result.text);
    console.log(`[doc-extraction] method=${result.method}, encoding=${result.encoding}, textLen=${result.text.length}, isOLE2=${isOLE2(bytes)}`);
    return { text: result.text, method: result.method, encoding: result.encoding, quality };
  }

  // DOCX — proper ZIP-based extraction
  if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try {
      // DOCX is a ZIP archive; use DecompressionStream to read word/document.xml
      const docXml = await extractDocxEntry(bytes, "word/document.xml");
      if (docXml) {
        // Parse w:t text nodes, respecting w:p paragraph boundaries
        const paragraphs: string[] = [];
        // Split by <w:p ...> paragraphs
        const pBlocks = docXml.split(/<w:p[\s>]/);
        let wtNodesFound = 0;
        for (const block of pBlocks) {
          const textParts: string[] = [];
          const wtMatches = block.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
          for (const m of wtMatches) {
            textParts.push(m[1]);
            wtNodesFound++;
          }
          if (textParts.length > 0) {
            paragraphs.push(textParts.join(""));
          }
        }
        const text = paragraphs.join("\n");
        console.log(`[docx-extraction] ZIP ok, document.xml found, w:t nodes=${wtNodesFound}, paragraphs=${paragraphs.length}, textLen=${text.length}`);
        let quality = assessTextQuality(text);
        // If ZIP extraction found real w:t nodes with substantial text, trust it
        if (!quality.readable && text.length > 50 && wtNodesFound > 3) {
          quality = { ...quality, readable: true, score: Math.max(quality.score, 0.5), reason: "docx_zip_trusted" };
        }
        if (quality.readable) {
          return { text, method: "docx_zip", encoding: "utf-8", quality };
        }
      } else {
        console.log(`[docx-extraction] word/document.xml not found in ZIP`);
      }
    } catch (e) {
      console.warn(`[docx-extraction] ZIP extraction failed: ${e}`);
    }
    // Fallback: try raw regex on decoded bytes (unlikely to work but preserves old path)
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const matches = raw.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    const parts: string[] = [];
    for (const m of matches) parts.push(m[1]);
    const text = parts.join(" ");
    return { text, method: "docx_xml_fallback", encoding: "utf-8", quality: assessTextQuality(text) };
  }

  // XLSX/XLS
  if (["xlsx", "xls"].includes(ext)) {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const matches = raw.matchAll(/<t[^>]*>([^<]*)<\/t>/g);
    const parts: string[] = [];
    for (const m of matches) parts.push(m[1]);
    const text = parts.length > 0 ? parts.join(" ") : raw.replace(/[^ -~\n\r\t]/g, " ").replace(/\s+/g, " ").slice(0, 50000);
    return { text, method: "spreadsheet_xml", quality: assessTextQuality(text) };
  }

  // Fallback
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, 50000);
  return { text, method: "fallback_decode", quality: assessTextQuality(text) };
}

function categorizeFile(fileType: string): string {
  switch (fileType) {
    case "pdf": return "pdf";
    case "doc": case "docx": return "word";
    case "xls": case "xlsx": case "csv": return "spreadsheet";
    case "txt": return "text";
    case "md": return "markdown";
    case "rtf": return "rich_text";
    default: return "other";
  }
}

const ACTIVE_STATES = new Set([
  "extracting_metadata", "extracting_content", "detecting_language", "summarizing", "indexing",
  "chunking", "generating_embeddings",
]);

// ─── Chunking ──────────────────────────────────────────────────────────

const CHUNK_SIZE = 1000;   // target chars per chunk
const CHUNK_OVERLAP = 200; // overlap chars between consecutive chunks
const MIN_CHUNK_LENGTH = 50; // skip near-empty chunks

function chunkText(text: string): { chunk_text: string; chunk_index: number }[] {
  if (!text || text.trim().length < MIN_CHUNK_LENGTH) return [];

  // Split into paragraphs first
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: { chunk_text: string; chunk_index: number }[] = [];
  let currentChunk = "";
  let chunkIndex = 0;

  for (const para of paragraphs) {
    // If adding this paragraph would exceed chunk size, flush current chunk
    if (currentChunk.length > 0 && currentChunk.length + para.length + 1 > CHUNK_SIZE) {
      if (currentChunk.trim().length >= MIN_CHUNK_LENGTH) {
        chunks.push({ chunk_text: currentChunk.trim(), chunk_index: chunkIndex++ });
      }
      // Start next chunk with overlap from the tail of the current chunk
      const overlapText = currentChunk.slice(-CHUNK_OVERLAP).trim();
      currentChunk = overlapText ? overlapText + "\n\n" + para : para;
    } else {
      currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
    }

    // If a single paragraph exceeds chunk size, split it by sentences/length
    while (currentChunk.length > CHUNK_SIZE * 1.5) {
      const splitAt = findSplitPoint(currentChunk, CHUNK_SIZE);
      const piece = currentChunk.slice(0, splitAt).trim();
      if (piece.length >= MIN_CHUNK_LENGTH) {
        chunks.push({ chunk_text: piece, chunk_index: chunkIndex++ });
      }
      const overlapStart = Math.max(0, splitAt - CHUNK_OVERLAP);
      currentChunk = currentChunk.slice(overlapStart).trim();
    }
  }

  // Flush remaining
  if (currentChunk.trim().length >= MIN_CHUNK_LENGTH) {
    chunks.push({ chunk_text: currentChunk.trim(), chunk_index: chunkIndex++ });
  }

  return chunks;
}

function findSplitPoint(text: string, target: number): number {
  // Try to split at sentence boundary near the target
  const region = text.slice(Math.max(0, target - 200), Math.min(text.length, target + 200));
  const sentenceEnd = region.search(/[.!?]\s/);
  if (sentenceEnd !== -1) {
    return Math.max(0, target - 200) + sentenceEnd + 2;
  }
  // Fallback: split at word boundary
  const lastSpace = text.lastIndexOf(' ', target);
  return lastSpace > target * 0.5 ? lastSpace : target;
}

function estimateTokenCount(text: string): number {
  // Rough estimate: ~4 chars per token for English, ~3 for other scripts
  return Math.ceil(text.length / 3.5);
}

// ─── Embeddings ────────────────────────────────────────────────────────

const EMBEDDING_BATCH_SIZE = 20; // chunks per API call

async function generateEmbeddings(
  texts: string[],
  apiKey: string,
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: batch,
          model: "openai/text-embedding-3-small",
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`Embeddings API error (batch ${i}): ${resp.status} ${errText}`);
        continue;
      }

      const data = await resp.json();
      if (data.data && Array.isArray(data.data)) {
        for (const item of data.data) {
          if (item.embedding && typeof item.index === "number") {
            results[i + item.index] = item.embedding;
          }
        }
      }
    } catch (e) {
      console.error(`Embeddings batch ${i} failed:`, e);
    }
  }

  return results;
}

// ─── Main Handler ──────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();
    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: doc, error: docErr } = await supabase
      .from("documents").select("*").eq("id", documentId).single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (doc.processing_status === "completed") {
      return new Response(JSON.stringify({ status: "already_completed", documentId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (ACTIVE_STATES.has(doc.processing_status)) {
      return new Response(JSON.stringify({ status: "already_processing", documentId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("documents").update({
      processing_status: "extracting_metadata",
      processing_error: null,
      retry_count: (doc.retry_count || 0) + 1,
      last_retry_at: new Date().toISOString(),
    }).eq("id", documentId);

    // Download file
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("insight-navigator").download(doc.storage_path);

    if (dlErr || !fileData) {
      await supabase.from("documents").update({
        processing_status: "failed",
        processing_error: `Download failed: ${dlErr?.message || "unknown"}`,
      }).eq("id", documentId);
      return new Response(JSON.stringify({ error: "Failed to download file" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());

    // Extract content
    await supabase.from("documents").update({ processing_status: "extracting_content" }).eq("id", documentId);
    const extraction = await extractText(bytes, doc.mime_type, doc.file_name);

    // Filter structural noise from extracted text
    const cleanedText = filterStructuralNoise(extraction.text);
    const effectiveText = cleanedText.length > 50 ? cleanedText : extraction.text;
    const stats = countStats(effectiveText);
    const scriptInfo = detectScript(effectiveText);
    const noiseRatio = computeStructuralNoiseRatio(extraction.text);

    console.log(`[${documentId}] Extraction: method=${extraction.method}, encoding=${extraction.encoding || "n/a"}, quality_score=${extraction.quality.score}, readable=${extraction.quality.readable}, words=${extraction.quality.wordCount}, readableCharRatio=${extraction.quality.readableCharRatio}, structuralNoiseRatio=${Math.round(noiseRatio * 100)}%, script=${scriptInfo.primary}, cleanedTextLen=${cleanedText.length}, rawTextLen=${extraction.text.length}`);

    // If extraction produced no readable text, mark as failed
    if (!extraction.quality.readable) {
      await supabase.from("documents").update({
        processing_status: "failed",
        processing_error: `Text extraction failed: ${extraction.quality.reason} (method: ${extraction.method}, encoding: ${extraction.encoding || "n/a"}, score: ${extraction.quality.score})`,
        word_count: stats.word_count,
        char_count: stats.char_count,
      }).eq("id", documentId);

      await supabase.from("document_analysis").upsert({
        document_id: documentId,
        user_id: doc.user_id,
        extracted_text: extraction.text.slice(0, 500000),
        normalized_search_text: null,
        metadata_json: {
          original_size: doc.file_size,
          mime_type: doc.mime_type,
          extraction_method: extraction.method,
          extraction_encoding: extraction.encoding || null,
          quality_score: extraction.quality.score,
          readable_char_ratio: extraction.quality.readableCharRatio,
          pdf_syntax_ratio: extraction.quality.pdfSyntaxRatio,
          structural_noise_ratio: noiseRatio,
          quality_reason: extraction.quality.reason,
          file_category: categorizeFile(doc.file_type),
          detected_script: scriptInfo.primary,
          script_ratios: { latin: scriptInfo.latinRatio, cyrillic: scriptInfo.cyrillicRatio },
        },
        ocr_used: false,
      }, { onConflict: "document_id" });

      return new Response(JSON.stringify({
        status: "failed",
        documentId,
        reason: extraction.quality.reason,
        extraction_method: extraction.method,
        extraction_encoding: extraction.encoding || null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Language detection — use cleaned text
    await supabase.from("documents").update({
      processing_status: "detecting_language",
      word_count: stats.word_count,
      char_count: stats.char_count,
    }).eq("id", documentId);

    const langResult = detectLanguage(effectiveText);

    console.log(`[${documentId}] Language: ${langResult.language}, script=${langResult.script}, confidence=${langResult.confidence}`);

    await supabase.from("documents").update({
      processing_status: "summarizing",
      detected_language: langResult.language,
    }).eq("id", documentId);

    // Generate summary — use cleaned text, not raw
    let summary = "";
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY && effectiveText.trim().length > 50) {
      try {
        const textForSummary = effectiveText.slice(0, 8000);
        const langHint = langResult.language === "sr"
          ? `The document is in Serbian (${langResult.script} script). Produce the summary in Serbian.`
          : langResult.language !== "en"
            ? `The document is in ${langResult.language}. Produce the summary in that language.`
            : "";

        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [
              { role: "system", content: `You are a document summarizer. Produce a concise summary of 2-5 sentences based on the actual content of the document. Be factual, neutral, and informative. No markdown. Focus on the main topics, arguments, or information in the document body. Ignore any structural metadata, XML fragments, or file container information. ${langHint}` },
              { role: "user", content: `Summarize this document titled "${doc.file_name}":\n\n${textForSummary}` },
            ],
          }),
        });
        if (aiResp.ok) {
          const aiData = await aiResp.json();
          summary = aiData.choices?.[0]?.message?.content || "";
        }
      } catch (e) {
        console.warn("Summary generation failed:", e);
      }
    }

    // Indexing
    await supabase.from("documents").update({
      processing_status: "indexing",
      summary: summary || null,
    }).eq("id", documentId);

    const searchText = normalizeForSearch(effectiveText, doc.file_name, summary);

    await supabase.from("document_analysis").upsert({
      document_id: documentId,
      user_id: doc.user_id,
      extracted_text: effectiveText.slice(0, 500000),
      normalized_search_text: searchText.slice(0, 500000),
      metadata_json: {
        original_size: doc.file_size,
        mime_type: doc.mime_type,
        word_count: stats.word_count,
        char_count: stats.char_count,
        line_count: stats.line_count,
        detected_language: langResult.language,
        detected_script: langResult.script,
        language_confidence: langResult.confidence,
        file_category: categorizeFile(doc.file_type),
        extraction_method: extraction.method,
        extraction_encoding: extraction.encoding || null,
        quality_score: extraction.quality.score,
        readable_char_ratio: extraction.quality.readableCharRatio,
        pdf_syntax_ratio: extraction.quality.pdfSyntaxRatio,
        structural_noise_ratio: noiseRatio,
        structural_noise_filtered: cleanedText.length < extraction.text.length,
        script_ratios: {
          latin: scriptInfo.latinRatio,
          cyrillic: scriptInfo.cyrillicRatio,
          arabic: scriptInfo.arabicRatio,
          cjk: scriptInfo.cjkRatio,
        },
      },
      ocr_used: false,
      indexed_at: new Date().toISOString(),
    }, { onConflict: "document_id" });

    // ── Chunking ──
    await supabase.from("documents").update({ processing_status: "chunking" }).eq("id", documentId);

    const chunks = chunkText(effectiveText);
    console.log(`[${documentId}] Chunked into ${chunks.length} chunks`);

    let embeddingsGenerated = 0;

    if (chunks.length > 0 && LOVABLE_API_KEY) {
      // ── Generate Embeddings ──
      await supabase.from("documents").update({ processing_status: "generating_embeddings" }).eq("id", documentId);

      const chunkTexts = chunks.map(c => c.chunk_text);
      const embeddings = await generateEmbeddings(chunkTexts, LOVABLE_API_KEY);
      embeddingsGenerated = embeddings.filter(e => e !== null).length;

      console.log(`[${documentId}] Generated ${embeddingsGenerated}/${chunks.length} embeddings`);

      // ── Delete stale chunks for this document (reprocessing) ──
      await supabase.from("document_chunks").delete().eq("document_id", documentId);

      // ── Insert chunks ──
      const chunkRows = chunks.map((c, idx) => ({
        document_id: documentId,
        user_id: doc.user_id,
        project_id: doc.project_id || null,
        chat_id: doc.chat_id || null,
        notebook_id: doc.notebook_id || null,
        chunk_index: c.chunk_index,
        chunk_text: c.chunk_text,
        embedding: embeddings[idx] ? JSON.stringify(embeddings[idx]) : null,
        token_count: estimateTokenCount(c.chunk_text),
        language: langResult.language,
        metadata_json: {
          extraction_method: extraction.method,
          quality_score: extraction.quality.score,
        },
      }));

      // Insert in batches of 50 to avoid payload limits
      for (let i = 0; i < chunkRows.length; i += 50) {
        const batch = chunkRows.slice(i, i + 50);
        const { error: insertErr } = await supabase.from("document_chunks").insert(batch);
        if (insertErr) {
          console.error(`[${documentId}] Chunk insert batch ${i} error:`, insertErr);
          throw new Error(`Failed to store chunks: ${insertErr.message}`);
        }
      }
    } else if (chunks.length === 0) {
      console.log(`[${documentId}] No chunks generated (text too short or empty)`);
    }

    await supabase.from("documents").update({
      processing_status: "completed",
      processing_error: null,
    }).eq("id", documentId);

    return new Response(JSON.stringify({
      status: "completed",
      documentId,
      word_count: stats.word_count,
      detected_language: langResult.language,
      detected_script: langResult.script,
      language_confidence: langResult.confidence,
      summary_length: summary.length,
      extraction_method: extraction.method,
      extraction_encoding: extraction.encoding || null,
      quality_score: extraction.quality.score,
      structural_noise_filtered: cleanedText.length < extraction.text.length,
      chunks_generated: chunks.length,
      embeddings_generated: embeddingsGenerated,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("process-document error:", e);
    try {
      const { documentId } = await req.clone().json();
      if (documentId) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, serviceKey);
        await supabase.from("documents").update({
          processing_status: "failed",
          processing_error: e instanceof Error ? e.message : "Unknown error",
        }).eq("id", documentId);
      }
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
