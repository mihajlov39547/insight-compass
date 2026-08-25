// @ts-nocheck
// Shared normalization + safety scrubbing for the SerpAPI Google AI Mode
// "visual second opinion" provider.
//
// This provider is ADVISORY ONLY. It is never a confirmed identification or a
// confirmed diagnosis, and it must never surface chemical treatment specifics
// or the identity of a person.

export type VisualOpinionMode = 'identify' | 'diagnose';

export type VisualSupport = 'supports' | 'conflicts' | 'inconclusive' | 'not_plant';
export type ConfidenceAdjustment = 'increase' | 'unchanged' | 'decrease';
export type ConfidenceLabel = 'high' | 'medium' | 'low' | 'uncertain';
export type SupportLevel = 'strong' | 'moderate' | 'weak';

export interface VisualCandidate {
  name: string;
  scientificName?: string | null;
  commonName?: string | null;
  reason?: string | null;
  supportLevel: SupportLevel;
  matchesConfirmedPlant: boolean;
}

export interface VisualProblemCandidate {
  name: string;
  reason?: string | null;
  supportLevel: SupportLevel;
  matchesConfirmedDiagnosis: boolean;
}

/** Context used to derive the verification layer (never mutates provider data). */
export interface VisualVerificationContext {
  confirmedScientificName?: string | null;
  confirmedCommonName?: string | null;
  confirmedDiagnosisName?: string | null;
  /** Pl@ntNet confidence bucket of the confirmed/top identification. */
  identBucket?: ConfidenceLabel | null;
}

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
  // ---- Verification layer (derived, advisory, never overwrites providers) ----
  visualSupport: VisualSupport;
  confidenceAdjustment: ConfidenceAdjustment;
  overallConfidenceLabel: ConfidenceLabel;
  primaryVisualCandidate: VisualCandidate | null;
  visualCandidates: VisualCandidate[];
  visualProblemCandidates: VisualProblemCandidate[];
  invalidCandidatesRemoved: string[];
  verificationSummary: string;
  nextPhotoSuggestions: string[];
  displayBullets: string[];
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
  ctx: VisualVerificationContext = {},
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

  const extraction = isPlantImage
    ? extractPlantCandidates(scrubbedPlain, sentences)
    : { candidates: [] as RawCandidate[], invalid: [] as string[] };

  const possiblePlantNames = extraction.candidates.map((c) => c.scientificName || c.name).slice(0, 6);
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

  const verification = deriveVisualVerification({
    mode,
    lang,
    notAPlantImage,
    wrongImage: WRONG_IMAGE_RE.test(plain),
    candidates: extraction.candidates,
    problemNames: possibleProblemNames,
    sentences,
    bullets,
    missingPhotoSuggestions,
    ctx,
  });

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
    visualSupport: verification.visualSupport,
    confidenceAdjustment: verification.confidenceAdjustment,
    overallConfidenceLabel: verification.overallConfidenceLabel,
    primaryVisualCandidate: verification.primaryVisualCandidate,
    visualCandidates: verification.visualCandidates,
    visualProblemCandidates: verification.visualProblemCandidates,
    invalidCandidatesRemoved: extraction.invalid.slice(0, 12),
    verificationSummary: verification.verificationSummary,
    nextPhotoSuggestions: verification.nextPhotoSuggestions,
    displayBullets: verification.displayBullets,
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

// ---------------------------------------------------------------------------
// Candidate extraction
// ---------------------------------------------------------------------------

interface RawCandidate {
  name: string;
  scientificName: string | null;
  commonName: string | null;
  reason: string | null;
  mentions: number;
  firstIndex: number;
}

const STOP_FIRST_WORD = new Set(
  [
    'the', 'this', 'these', 'those', 'that', 'it', 'its', 'image', 'images', 'photo', 'photos',
    'plant', 'plants', 'based', 'google', 'common', 'clear', 'blossoms', 'leaves', 'leaf', 'pods',
    'pod', 'flowers', 'flower', 'seeds', 'seed', 'also', 'however', 'while', 'both', 'here',
    'what', 'when', 'if', 'you', 'your', 'they', 'there', 'some', 'many', 'most', 'other',
    'another', 'care', 'growing', 'additional', 'possible', 'alternatives', 'from', 'with', 'for',
    'and', 'but', 'note', 'search', 'wikipedia', 'youtube', 'video', 'how', 'sources', 'source',
    'overall', 'visual', 'because', 'since', 'look', 'looks', 'vine', 'vines', 'fruit', 'fruits',
    'stem', 'stems', 'roots', 'root', 'garden', 'gardening', 'harvest', 'summary', 'answer',
  ].map((w) => w),
);

const STOP_SECOND_WORD = new Set([
  'produce', 'provide', 'provides', 'show', 'shows', 'shown', 'appear', 'appears', 'looks', 'look',
  'are', 'is', 'was', 'were', 'has', 'have', 'can', 'could', 'may', 'might', 'and', 'the', 'with',
  'from', 'plant', 'plants', 'image', 'images', 'photo', 'photos', 'care', 'growing', 'leaves',
  'pods', 'seeds', 'flowers', 'tips', 'guide', 'used', 'using', 'usually', 'often', 'also', 'like',
  'such', 'based', 'need', 'needs', 'including', 'include', 'list', 'more', 'than', 'that', 'this',
  'these', 'those', 'similar', 'different', 'other', 'another', 'many', 'most', 'some', 'both',
  'best', 'good', 'clear', 'close', 'their', 'its', 'which', 'while', 'when', 'where', 'because',
  'since', 'after', 'before', 'about', 'into', 'over', 'under', 'between', 'grows', 'grow',
  'requires', 'prefers', 'tends', 'produces', 'features', 'belongs', 'means', 'seems',
]);

function looksLikeBinomial(value: string): boolean {
  const m = value.match(/^([A-Z][a-z]{3,})\s+([a-z-]{4,})$/);
  if (!m) return false;
  const [, genus, species] = m;
  if (STOP_FIRST_WORD.has(genus.toLowerCase())) return false;
  if (STOP_SECOND_WORD.has(species)) return false;
  if (/(ing|ed|ly)$/.test(species)) return false;
  return true;
}

function normalizeBinomial(value: string): string {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 2) return value.trim();
  return `${parts[0][0].toUpperCase()}${parts[0].slice(1).toLowerCase()} ${parts[1].toLowerCase()}`;
}

function titleCase(value: string): string {
  const v = value.trim().replace(/\s+/g, ' ');
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * Extracts clean plant-name candidates: scientific binomials plus common names
 * paired with them. Sentence fragments and generic phrases are rejected and
 * reported back so the UI can show what was filtered out.
 */
function extractPlantCandidates(
  text: string,
  sentences: string[],
): { candidates: RawCandidate[]; invalid: string[] } {
  const invalid: string[] = [];
  const byKey = new Map<string, RawCandidate>();

  // Common-name ↔ scientific-name pairings such as "Common bean (Phaseolus vulgaris)".
  const commonBySci = new Map<string, string>();
  const pairA = /([A-Z][A-Za-z-]*(?:\s+[a-z-]+){0,2})\s*\(\s*([A-Z][a-z]{3,}\s+[a-z-]{4,})\s*\)/g;
  for (const m of text.matchAll(pairA)) {
    if (!looksLikeBinomial(m[2])) continue;
    const common = m[1].trim();
    if (common.split(/\s+/).length > 3) continue;
    commonBySci.set(normalizeBinomial(m[2]), titleCase(common));
  }
  const pairB = /([A-Z][a-z]{3,}\s+[a-z-]{4,})\s*\(\s*([A-Za-z][A-Za-z\s-]{2,30}?)\s*\)/g;
  for (const m of text.matchAll(pairB)) {
    if (!looksLikeBinomial(m[1])) continue;
    const common = m[2].trim();
    if (common.split(/\s+/).length > 3) continue;
    if (!commonBySci.has(normalizeBinomial(m[1]))) {
      commonBySci.set(normalizeBinomial(m[1]), titleCase(common));
    }
  }

  const rawMatches = text.match(/\b[A-Z][a-z]{2,}\s+[a-z-]{3,}\b/g) ?? [];
  for (const raw of rawMatches) {
    if (!looksLikeBinomial(raw)) {
      if (!invalid.includes(raw)) invalid.push(raw);
      continue;
    }
    const sci = normalizeBinomial(raw);
    const existing = byKey.get(sci);
    if (existing) {
      existing.mentions += 1;
      continue;
    }
    byKey.set(sci, {
      name: sci,
      scientificName: sci,
      commonName: commonBySci.get(sci) ?? null,
      reason: sentences.find((s) => s.includes(raw)) ?? null,
      mentions: 1,
      firstIndex: text.indexOf(raw),
    });
  }

  const candidates = [...byKey.values()].sort((a, b) => {
    if (b.mentions !== a.mentions) return b.mentions - a.mentions;
    return a.firstIndex - b.firstIndex;
  });
  return { candidates: candidates.slice(0, 6), invalid };
}

// ---------------------------------------------------------------------------
// Verification derivation
// ---------------------------------------------------------------------------

const BUCKETS: ConfidenceLabel[] = ['uncertain', 'low', 'medium', 'high'];

function shiftBucket(base: ConfidenceLabel, adj: ConfidenceAdjustment): ConfidenceLabel {
  const i = Math.max(0, BUCKETS.indexOf(base));
  if (adj === 'increase') return BUCKETS[Math.min(BUCKETS.length - 1, i + 1)];
  if (adj === 'decrease') return BUCKETS[Math.max(0, i - 1)];
  return BUCKETS[i];
}

function genusOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const g = name.trim().split(/\s+/)[0];
  return g ? g.toLowerCase() : null;
}

function speciesOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  return parts[1] ? parts[1].toLowerCase() : null;
}

const WHY_RE =
  /\b(leaf|leaves|leaflet|trifoliate|pod|pods|fruit|seed|seeds|flower|flowers|blossom|habit|climbing|bush|vine|stem|tendril|list|lišć|lisc|mahun|plod|seme|cvet|stablj|vitica)\b/i;

const PHOTO_HINTS: Record<'identify' | 'diagnose', Record<'en' | 'sr', string[]>> = {
  identify: {
    en: ['A clear photo of the flowers', 'A photo of the whole plant and its growth habit', 'A close-up of mature pods, fruit or seeds'],
    sr: ['Jasna fotografija cvetova', 'Fotografija cele biljke i načina rasta', 'Krupni plan zrelih mahuna, plodova ili semena'],
  },
  diagnose: {
    en: ['A close-up of the affected leaf, top and underside', 'A photo showing how symptoms are spread over the plant', 'A photo of affected fruit, stems or pods'],
    sr: ['Krupni plan zaraženog lista, lice i poleđina', 'Fotografija koja pokazuje raspored simptoma po biljci', 'Fotografija zaraženih plodova, stabljika ili mahuna'],
  },
};

function shorten(s: string, max = 140): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function dedupeLines(lines: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = shorten(raw);
    const key = line.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

function supportLevelFor(index: number, mentions: number): SupportLevel {
  if (index === 0 && mentions >= 2) return 'strong';
  if (index === 0 || mentions >= 2) return 'moderate';
  return 'weak';
}

export function deriveVisualVerification(input: {
  mode: VisualOpinionMode;
  lang: 'en' | 'sr';
  notAPlantImage: boolean;
  wrongImage: boolean;
  candidates: RawCandidate[];
  problemNames: string[];
  sentences: string[];
  bullets: string[];
  missingPhotoSuggestions: string[];
  ctx: VisualVerificationContext;
}): {
  visualSupport: VisualSupport;
  confidenceAdjustment: ConfidenceAdjustment;
  overallConfidenceLabel: ConfidenceLabel;
  primaryVisualCandidate: VisualCandidate | null;
  visualCandidates: VisualCandidate[];
  visualProblemCandidates: VisualProblemCandidate[];
  verificationSummary: string;
  nextPhotoSuggestions: string[];
  displayBullets: string[];
} {
  const { mode, lang, notAPlantImage, candidates, problemNames, sentences, bullets, ctx } = input;
  const sr = lang === 'sr';
  const baseBucket: ConfidenceLabel = ctx.identBucket ?? 'uncertain';

  const confirmedSci = ctx.confirmedScientificName ?? null;
  const confirmedGenus = genusOf(confirmedSci);
  const confirmedSpecies = speciesOf(confirmedSci);

  const visualCandidates: VisualCandidate[] = candidates.map((c, i) => {
    const matches =
      !!confirmedGenus &&
      genusOf(c.scientificName) === confirmedGenus &&
      speciesOf(c.scientificName) === confirmedSpecies;
    return {
      name: c.name,
      scientificName: c.scientificName,
      commonName: c.commonName,
      reason: c.reason ? shorten(c.reason) : null,
      supportLevel: supportLevelFor(i, c.mentions),
      matchesConfirmedPlant: matches,
    };
  });

  const matching = visualCandidates.find((c) => c.matchesConfirmedPlant) ?? null;
  const primaryVisualCandidate = matching ?? visualCandidates[0] ?? null;

  let visualSupport: VisualSupport = 'inconclusive';
  let confidenceAdjustment: ConfidenceAdjustment = 'unchanged';

  if (notAPlantImage) {
    visualSupport = 'not_plant';
    confidenceAdjustment = 'decrease';
  } else if (mode === 'identify') {
    if (!confirmedSci || visualCandidates.length === 0) {
      visualSupport = 'inconclusive';
      confidenceAdjustment = 'unchanged';
    } else if (matching) {
      visualSupport = 'supports';
      confidenceAdjustment = 'increase';
    } else if (genusOf(primaryVisualCandidate?.scientificName) === confirmedGenus) {
      visualSupport = 'inconclusive';
      confidenceAdjustment = 'unchanged';
    } else {
      visualSupport = 'conflicts';
      confidenceAdjustment = 'decrease';
    }
  } else {
    const diagName = (ctx.confirmedDiagnosisName ?? '').toLowerCase();
    const diagTokens = diagName.split(/[\s(),-]+/).filter((w) => w.length > 3);
    const supportsDiag =
      diagTokens.length > 0 && problemNames.some((p) => diagTokens.some((t) => p.includes(t) || t.includes(p)));
    if (supportsDiag) {
      visualSupport = 'supports';
      confidenceAdjustment = 'increase';
    } else if (problemNames.length > 0 && diagTokens.length > 0) {
      visualSupport = 'conflicts';
      confidenceAdjustment = 'decrease';
    } else {
      visualSupport = 'inconclusive';
      confidenceAdjustment = 'unchanged';
    }
  }

  const overallConfidenceLabel = notAPlantImage
    ? 'uncertain'
    : shiftBucket(baseBucket, confidenceAdjustment);

  const visualProblemCandidates: VisualProblemCandidate[] =
    mode === 'diagnose'
      ? problemNames.slice(0, 4).map((p, i) => {
          const diagName = (ctx.confirmedDiagnosisName ?? '').toLowerCase();
          return {
            name: titleCase(p),
            reason: sentences.find((s) => s.toLowerCase().includes(p)) ? shorten(sentences.find((s) => s.toLowerCase().includes(p))!) : null,
            supportLevel: i === 0 ? 'moderate' : 'weak',
            matchesConfirmedDiagnosis: !!diagName && (diagName.includes(p) || p.includes(diagName)),
          };
        })
      : [];

  const displayBullets = dedupeLines(
    [...bullets, ...sentences].filter((l) => WHY_RE.test(l)),
    3,
  );

  const cleanedPhotos = dedupeLines(input.missingPhotoSuggestions, 3);
  const nextPhotoSuggestions =
    cleanedPhotos.length > 0 ? cleanedPhotos : PHOTO_HINTS[mode][lang].slice(0, 3);

  const confirmedLabel = confirmedSci || ctx.confirmedCommonName || (sr ? 'potvrđenu biljku' : 'the confirmed plant');
  let verificationSummary: string;
  if (visualSupport === 'not_plant') {
    verificationSummary = sr
      ? 'Ova slika možda ne prikazuje biljku. Dodajte jasne fotografije biljke.'
      : 'This image may not show a plant. Add clear photos of the plant.';
  } else if (mode === 'identify') {
    if (visualSupport === 'supports') {
      verificationSummary = sr
        ? `Vizuelna provera podržava potvrđenu identifikaciju (${confirmedLabel}), pa je ukupna pouzdanost veća.`
        : `The visual check supports the confirmed identification (${confirmedLabel}), so the overall confidence is higher.`;
    } else if (visualSupport === 'conflicts') {
      verificationSummary = sr
        ? 'Vizuelna provera predlaže drugu biljku. Pregledajte kandidate pre nego što se oslonite na ovaj slučaj.'
        : 'The visual check suggests a different plant. Review the candidates before relying on this case.';
    } else if (confirmedGenus && genusOf(primaryVisualCandidate?.scientificName) === confirmedGenus) {
      verificationSummary = sr
        ? 'Vizuelna provera podržava rod, ali je za proveru vrste potrebna fotografija cvetova, semena ili mahuna.'
        : 'The visual check supports the genus, but species verification still needs flowers, seeds or pods.';
    } else {
      verificationSummary = sr
        ? 'Vizuelna provera nije dovoljna. Dodajte bolje fotografije za proveru.'
        : 'The visual check is inconclusive. Add better verification photos.';
    }
  } else {
    if (visualSupport === 'supports') {
      verificationSummary = sr
        ? 'Vizuelna provera podržava potvrđenu dijagnozu, pa je ukupna pouzdanost veća.'
        : 'The visual check supports the confirmed diagnosis, so the overall confidence is higher.';
    } else if (visualSupport === 'conflicts') {
      verificationSummary = sr
        ? 'Vizuelna provera predlaže drugu kategoriju problema. Pregledajte kandidate pre odluke.'
        : 'The visual check suggests another problem category. Review the candidates before deciding.';
    } else {
      verificationSummary = sr
        ? 'Simptomi nisu dovoljno vidljivi. Dodajte bolje fotografije za proveru.'
        : 'Symptoms are not clearly visible. Add better verification photos.';
    }
  }

  return {
    visualSupport,
    confidenceAdjustment,
    overallConfidenceLabel,
    primaryVisualCandidate,
    visualCandidates,
    visualProblemCandidates,
    verificationSummary,
    nextPhotoSuggestions,
    displayBullets,
  };
}

