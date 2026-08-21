// @ts-nocheck
// Shared normalization + safety scrubbing for the SerpAPI Google AI Mode
// "visual second opinion" provider.
//
// This provider is ADVISORY ONLY. It is never a confirmed identification or a
// confirmed diagnosis, and it must never surface chemical treatment specifics
// or the identity of a person.

export type VisualOpinionMode = 'identify' | 'diagnose';

export interface VisualOpinionStructured {
  markdown: string;
  textBlocks: unknown[];
  firstParagraph: string;
  bullets: string[];
  saysNotPlant: boolean;
  saysWrongImage: boolean;
  possiblePlantNames: string[];
  possibleProblemNames: string[];
  missingPhotoSuggestions: string[];
  visibleSymptoms: string[];
  confidenceSignal: 'high' | 'medium' | 'low' | 'unknown';
  safetyFlags: {
    containsTreatmentAdvice: boolean;
    containsChemicalSpecifics: boolean;
    containsPersonIdentification: boolean;
    notAPlantImage: boolean;
  };
  searchMetadata: Record<string, unknown>;
  searchParameters: Record<string, unknown>;
  links: {
    googleAiModeUrl: string | null;
    jsonEndpoint: string | null;
    markdownEndpoint: string | null;
  };
}

const CHEMICAL_RE =
  /\b(pesticid\w*|fungicid\w*|herbicid\w*|insekticid\w*|pesticide|pesticides|fungicide|fungicides|herbicide|herbicides|insecticide|insecticides|neonicotinoid\w*|glyphosat\w*|glifosat\w*|imidacloprid|copper sulfate|bordeaux mixture|bordovska|mancozeb|chlorothalonil|azoxystrobin|spinosad|active ingredient|aktivna materija|aktivne materije)\b/i;

const DOSE_RE =
  /\b(\d+(\.\d+)?\s?(ml|l|g|kg|oz|gal)\s?(\/|per|na)\s?(l|liter|litre|litar|gal|gallon|ha|m2|m²)|dose|dosage|doza|doze|mixing rate|mešanj\w*|mesanj\w*|spray schedule|raspored prskanja|prskaj\w*|apply every|primenjuj\w*)\b/i;

const TREATMENT_RE =
  /\b(treat with|treatment with|apply (a )?(spray|fungicide|pesticide|insecticide)|tretiraj\w*|tretman\w*|poprskaj\w*|zaprašivanj\w*)\b/i;

const NOT_PLANT_RE =
  /\b(not (a|an) plant|does not (appear to )?(show|contain) (a )?plant|is not (a )?plant|no plant (is )?visible|this (image|photo) shows a (person|man|woman|human|face|animal|object|car|building)|nije biljka|ne prikazuje biljku|ne sadrži biljku|nema biljke)\b/i;

const PERSON_RE =
  /\b(person|man|woman|human|face|celebrity|actor|actress|singer|politician|portrait|osoba|čovek|covek|žena|zena|lice|glumac|pevač|pevac)\b/i;

const WRONG_IMAGE_RE =
  /\b(image (quality )?(is )?(too )?(blurry|blurred|dark|low[- ]quality|unclear)|cannot (be )?(clearly )?(seen|determined|identified) from (this|the) (image|photo)|hard to tell from (this|the) (image|photo)|slika je (mutna|nejasna|previše tamna|pretamna)|ne može\w* (se )?(pouzdano )?(odrediti|identifikovati))\b/i;

const MISSING_PHOTO_RE =
  /\b(photo|photos|picture|pictures|image|images|close[- ]?up|clearer|additional|another angle|fotograf\w*|slik\w*|snimak|krupni plan|bliži snimak|dodatn\w*)\b/i;

const SYMPTOM_RE =
  /\b(spot|spots|lesion|lesions|blotch|chlorosis|necrosis|wilt|wilting|yellowing|browning|curling|holes|webbing|powdery|rust|mold|mould|mildew|galls|scorch|pega|pege|mrlj\w*|nekroz\w*|hloroz\w*|žut\w*|zut\w*|uvenu\w*|rupe|plesniv\w*|rđ\w*|rdj\w*|paučin\w*|paucin\w*|sušenj\w*|susenj\w*)\b/i;

const HIGH_CONF_RE =
  /\b(clearly|definitely|certainly|is a\b|this is\b|confident|jasno|sigurno|definitivno|ovo je)\b/i;
const LOW_CONF_RE =
  /\b(cannot|can't|unclear|uncertain|difficult to|hard to|may be|might be|possibly|appears to|not (possible|enough)|ne mogu|nejasno|neizvesno|možda|mozda|verovatno|teško|tesko)\b/i;

function stripMarkdown(s: string): string {
  return s
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>]+/g, '')
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Removes chemical product names, doses and application instructions, plus any
 * person/celebrity identification, from provider text before it is stored or
 * displayed.
 */
export function scrubVisualOpinionText(raw: string, isPlantImage: boolean): string {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (CHEMICAL_RE.test(line) || DOSE_RE.test(line) || TREATMENT_RE.test(line)) continue;
    if (!isPlantImage && PERSON_RE.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function collectTextFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (typeof n.snippet === 'string') out.push(n.snippet);
    if (typeof n.text === 'string') out.push(n.text);
    if (typeof n.title === 'string') out.push(n.title);
    for (const key of ['list', 'items', 'blocks', 'text_blocks']) {
      const v = n[key];
      if (Array.isArray(v)) v.forEach(walk);
    }
  };
  (blocks as unknown[]).forEach(walk);
  return out.join('\n');
}

/** Normalizes a SerpAPI google_ai_mode payload into advisory, safe structure. */
export function normalizeSerpAiModeResult(
  payload: Record<string, any>,
  mode: VisualOpinionMode,
  lang: 'en' | 'sr',
): { structured: VisualOpinionStructured; summary: string } {
  const rawMarkdown =
    typeof payload?.reconstructed_markdown === 'string' ? payload.reconstructed_markdown : '';
  const blockText = collectTextFromBlocks(payload?.text_blocks);
  const combinedRaw = [rawMarkdown, blockText].filter(Boolean).join('\n');
  const plain = stripMarkdown(combinedRaw);

  const saysNotPlant = NOT_PLANT_RE.test(plain);
  const mentionsPerson = PERSON_RE.test(plain);
  const notAPlantImage = saysNotPlant || (mentionsPerson && !SYMPTOM_RE.test(plain) && !/plant|biljk|leaf|list|flower|cvet/i.test(plain));
  const isPlantImage = !notAPlantImage;

  const containsChemicalSpecifics = CHEMICAL_RE.test(plain) || DOSE_RE.test(plain);
  const containsTreatmentAdvice = TREATMENT_RE.test(plain) || containsChemicalSpecifics;

  const scrubbedMarkdown = scrubVisualOpinionText(rawMarkdown, isPlantImage);
  const scrubbedPlain = stripMarkdown(scrubVisualOpinionText(plain, isPlantImage));
  const sentences = splitSentences(scrubbedPlain);

  const bullets = scrubbedMarkdown
    .split(/\r?\n/)
    .filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))
    .map((l) => stripMarkdown(l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')))
    .filter((l) => l.length > 3)
    .slice(0, 12);

  const missingPhotoSuggestions = sentences
    .filter((s) => MISSING_PHOTO_RE.test(s) && /need|helpful|would help|provide|upload|take|potreb\w*|pomoć|pomoc|posla\w*|dodaj/i.test(s))
    .slice(0, 5);

  const visibleSymptoms = mode === 'diagnose' && isPlantImage
    ? sentences.filter((s) => SYMPTOM_RE.test(s)).slice(0, 6)
    : [];

  const possiblePlantNames = isPlantImage ? extractCandidateNames(scrubbedPlain).slice(0, 6) : [];
  const possibleProblemNames =
    mode === 'diagnose' && isPlantImage
      ? sentences
          .flatMap((s) => s.match(/\b(rust|blight|mildew|anthracnose|canker|rot|mosaic|scab|aphid\w*|mite\w*|beetle\w*|caterpillar\w*|thrips|scale insect\w*|rđa|rdja|plamenjača|plamenjaca|pepelnica|antraknoz\w*|čađav\w*|cadjav\w*|krastavost|trulež|trulez|vaši|vasi|grinj\w*|buba\w*|gusenic\w*)\b/gi) ?? [])
          .map((s) => s.toLowerCase())
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 6)
      : [];

  let confidenceSignal: VisualOpinionStructured['confidenceSignal'] = 'unknown';
  if (notAPlantImage) confidenceSignal = 'low';
  else if (LOW_CONF_RE.test(scrubbedPlain)) confidenceSignal = 'low';
  else if (HIGH_CONF_RE.test(scrubbedPlain)) confidenceSignal = 'high';
  else if (scrubbedPlain.length > 60) confidenceSignal = 'medium';

  const notPlantMessage =
    lang === 'sr'
      ? 'Slika ne deluje kao da prikazuje biljku.'
      : 'The image does not appear to show a plant.';

  const firstParagraph = notAPlantImage ? notPlantMessage : (sentences[0] ?? '');

  const summary = notAPlantImage
    ? notPlantMessage
    : (sentences.slice(0, 2).join(' ') || bullets[0] || '').slice(0, 600);

  const md = payload?.search_metadata ?? {};

  const structured: VisualOpinionStructured = {
    markdown: notAPlantImage ? notPlantMessage : scrubbedMarkdown,
    textBlocks: notAPlantImage ? [] : (Array.isArray(payload?.text_blocks) ? payload.text_blocks : []),
    firstParagraph,
    bullets: notAPlantImage ? [] : bullets,
    saysNotPlant: notAPlantImage,
    saysWrongImage: notAPlantImage || WRONG_IMAGE_RE.test(plain),
    possiblePlantNames,
    possibleProblemNames,
    missingPhotoSuggestions,
    visibleSymptoms,
    confidenceSignal,
    safetyFlags: {
      containsTreatmentAdvice,
      containsChemicalSpecifics,
      containsPersonIdentification: mentionsPerson,
      notAPlantImage,
    },
    searchMetadata: {
      id: md.id ?? null,
      status: md.status ?? null,
      created_at: md.created_at ?? null,
      processed_at: md.processed_at ?? null,
      total_time_taken: md.total_time_taken ?? null,
    },
    searchParameters: (payload?.search_parameters ?? {}) as Record<string, unknown>,
    links: {
      googleAiModeUrl: typeof md.google_ai_mode_url === 'string' ? md.google_ai_mode_url : null,
      jsonEndpoint: typeof md.json_endpoint === 'string' ? md.json_endpoint : null,
      markdownEndpoint: typeof md.markdown_endpoint === 'string' ? md.markdown_endpoint : null,
    },
  };

  return { structured, summary };
}

/** Best-effort scientific/common name candidates (Genus species or Capitalised pairs). */
function extractCandidateNames(text: string): string[] {
  const out: string[] = [];
  const sci = text.match(/\b[A-Z][a-z]{2,}\s+[a-z]{3,}\b/g) ?? [];
  for (const s of sci) {
    if (/^(The|This|It|Image|Photo|Plant|Google|Based)\b/.test(s)) continue;
    out.push(s);
  }
  return out.filter((v, i, a) => a.indexOf(v) === i);
}
