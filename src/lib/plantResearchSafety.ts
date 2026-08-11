// Safety scrubbing for Plant Advisor "Identify" research output.
//
// Identify-mode research must never turn into a treatment plan: no chemical
// product names, doses, mixing rates, or spray schedules. Deep research answers
// occasionally slip such details into a "management" section, so we scrub them
// out before the answer is persisted or displayed.

const TREATMENT_PATTERNS: RegExp[] = [
  /\b(pesticid|fungicid|insekticid|herbicid|akaricid)/i,
  /\b(pesticide|fungicide|insecticide|herbicide|miticide|acaricide)s?\b/i,
  /\b(spray|sprayed|spraying|prskanj|prskati|tretiranj|tretman hemij)/i,
  /\b(glyphosate|glifosat|imidacloprid|mancozeb|chlorothalonil|copper sulfate|bordeaux mixture|bordovska)/i,
  /\b(active ingredient|aktivn[ao] (?:materij|sastoj))/i,
  /\b\d+(?:[.,]\d+)?\s?(?:ml|l|g|kg|oz)\s?\/\s?(?:l|liter|litre|litar|ha|gal|gallon|100 ?l)\b/i,
  /\b(dose|dosage|doza|doziranj|mixing rate|koncentracij[ae] rastvora)\b/i,
  /\b(spray schedule|raspored prskanja|interval prskanja)\b/i,
];

function isTreatmentLine(line: string): boolean {
  return TREATMENT_PATTERNS.some((re) => re.test(line));
}

/**
 * Remove chemical-treatment guidance from a research answer.
 * Drops offending lines (and list items) while keeping the rest of the report
 * intact. Headings whose whole section is treatment-focused are removed too.
 */
export function scrubTreatmentGuidance(markdown: string): string {
  if (!markdown) return markdown;

  const lines = markdown.split('\n');
  const out: string[] = [];
  let skipSectionLevel: number | null = null;

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());

    if (heading) {
      const level = heading[1].length;
      if (skipSectionLevel !== null && level <= skipSectionLevel) {
        skipSectionLevel = null;
      }
      if (skipSectionLevel === null && isTreatmentLine(heading[2])) {
        skipSectionLevel = level;
        continue;
      }
      if (skipSectionLevel !== null) continue;
      out.push(line);
      continue;
    }

    if (skipSectionLevel !== null) continue;
    if (line.trim() && isTreatmentLine(line)) continue;
    out.push(line);
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Build the Tavily Research input for an Identify plant case. */
export function buildIdentifyResearchInput(
  commonName: string | null | undefined,
  scientificName: string | null | undefined,
  lang: 'en' | 'sr',
): string {
  const common = commonName?.trim() || '';
  const scientific = scientificName?.trim() || '';
  const primary = common || scientific;
  const label = common && scientific ? `${common} (${scientific})` : primary;

  if (lang === 'sr') {
    return `Istraži biljku ${label} za potrebe identifikacije. Fokusiraj se na taksonomiju, prihvaćene nazive, karakteristične osobine, slične vrste, prirodno rasprostranjenje, stanište, distribuciju, upotrebu i napomene, ekologiju i savete za proveru identifikacije. Uzgoj i rast navedi samo kao sekundarnu informaciju. Prioritet daj autoritativnim botaničkim izvorima (POWO/Kew, GBIF, IPNI, World Flora Online, floristične baze, univerziteti, državne institucije, botaničke bašte, organizacije za zaštitu prirode); izbegavaj opšte baštenske blogove i video sadržaj osim ako ne postoji bolji izvor. Ne postavljaj dijagnozu bolesti i ne daj uputstva za tretman, hemijske preparate, doze ili raspored prskanja. Počni odgovor direktno naslovom izveštaja — bez ponavljanja pitanja, zadatka ili napomena o jeziku i formatu.`;
  }
  return `Research the plant ${label} for identification purposes. Focus on taxonomy, accepted names, distinguishing features, similar/confusable species, native range, habitat, distribution, uses/cautions, ecology, and verification tips. Treat cultivation/growth only as secondary information. Prioritize authoritative botanical sources (POWO/Kew, GBIF, IPNI, World Flora Online, regional flora databases, universities, government agencies, botanical gardens, conservation authorities, and extension services where relevant); avoid generic gardening blogs and video pages unless no better source exists. Do not diagnose a plant disease and do not provide treatment instructions, chemical product names, doses, or spray schedules. Start the answer directly with the report title — do not restate the question, the task, or notes about language or formatting.`;

}

// ---------------------------------------------------------------------------
// Prompt-framing cleanup
//
// Tavily Research sometimes echoes our internal instruction framing at the top
// of the report ("Istraživačko pitanje (prvo lice, srpski, Latinica): …",
// "Research question: …", "Task: …"). None of that is user-facing content.
// ---------------------------------------------------------------------------

const FRAMING_LABELS =
  '(?:research\\s+question|user\\s+question|question|prompt|task|instructions?|istraživačko\\s+pitanje|pitanje\\s+korisnika|pitanje|zadatak|uputstv[oa]|nalog)';

// "Research question: ..." / "**Task**: ..." / "## Istraživačko pitanje (…): …"
const FRAMING_LINE = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?(?:[*_]{1,2})?\\s*${FRAMING_LABELS}\\b[^\\n:]*(?:[*_]{1,2})?\\s*:?\\s*.*$`,
  'i',
);

// Meta comments about language / person / formatting.
const META_LINE =
  /^\s*(?:#{1,6}\s*)?(?:[*_]{1,2})?\s*(?:(?:response\s+)?language|jezik(?:\s+odgovora)?|write\s+(?:the\s+)?(?:final\s+)?answer|answer\s+in\s+|odgovor(?:i)?\s+na\s+|first[- ]person|prvo\s+lice|use\s+(?:serbian|english|latin)|koristi\s+(?:srpski|latinicu)|format(?:ting)?\s*(?:instructions?)?|markdown)\b.*$/i;

/**
 * Strip internal prompt/task framing and language meta comments from a
 * research report, keeping the actual report content.
 * Only cleans the leading preamble (before real content begins).
 */
export function stripResearchPromptFraming(markdown: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split('\n');
  let i = 0;
  let removedAny = false;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (FRAMING_LINE.test(line) || META_LINE.test(line)) {
      removedAny = true;
      i++;
      // Drop any indented/continuation lines that belong to the framing block.
      while (i < lines.length && /^\s*(?:>|[-*]\s|\s{2,}\S)/.test(lines[i])) {
        i++;
      }
      continue;
    }
    break;
  }

  const rest = lines.slice(i).join('\n').replace(/^\s+/, '');
  return removedAny ? rest : markdown;
}

/**
 * Remove standalone numeric citation markers ([1], [2][3], [1, 2]) when the
 * report has no rendered numbered bibliography — the "Sources used" UI is the
 * authoritative citation surface. Markdown links like [1](https://…) are kept.
 */
export function normalizeResearchCitations(markdown: string): string {
  if (!markdown) return markdown;
  const hasNumberedBibliography =
    /^\s*\[?\d+\]?[.)]?\s+https?:\/\//m.test(markdown) ||
    /^\s*\[\d+\]\s+\S+\s+—\s+https?:\/\//m.test(markdown);
  if (hasNumberedBibliography) return markdown;

  return markdown
    .replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\](?!\()/g, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Full post-processing pipeline for Identify research output. */
export function polishIdentifyResearchAnswer(markdown: string): string {
  return normalizeResearchCitations(
    stripResearchPromptFraming(scrubTreatmentGuidance(markdown || '')),
  );
}

// ---------------------------------------------------------------------------
// Source authority ranking for Identify research
// ---------------------------------------------------------------------------

const AUTHORITY_TIERS: Array<{ score: number; patterns: RegExp[] }> = [
  {
    // Core taxonomic / flora authorities
    score: 100,
    patterns: [
      /(^|\.)powo\.science\.kew\.org$/i,
      /kew\.org$/i,
      /gbif\.org$/i,
      /ipni\.org$/i,
      /worldfloraonline\.org$/i,
      /tropicos\.org$/i,
      /theplantlist\.org$/i,
      /catalogueoflife\.org$/i,
      /efloras\.org$/i,
      /floraofserbia|floraweb|euroflora|flora\w*\.(org|net|info)$/i,
      /plantsoftheworldonline/i,
    ],
  },
  {
    // Government, conservation & botanical institutions
    score: 80,
    patterns: [
      /(\.|^)gov(\.[a-z]{2})?$/i,
      /(\.|^)gov\./i,
      /iucnredlist\.org$/i,
      /eunis\.eea\.europa\.eu$/i,
      /europa\.eu$/i,
      /usda\.gov$/i,
      /botanicgardens?|botanicalgarden|missouribotanicalgarden|rbge\.org\.uk|nybg\.org|bgci\.org/i,
    ],
  },
  {
    // Universities & extension services
    score: 65,
    patterns: [/(\.|^)edu(\.[a-z]{2})?$/i, /(\.|^)ac\.[a-z]{2}$/i, /extension\./i, /\.uni-/i],
  },
  {
    // Curated reference / encyclopedic
    score: 45,
    patterns: [/wikipedia\.org$/i, /wikispecies|inaturalist\.org$|plantnet|tela-botanica/i],
  },
];

const DOWNRANK_PATTERNS: RegExp[] = [
  /youtube\.com$|youtu\.be$|vimeo\.com$|tiktok\.com$/i,
  /pinterest\.|facebook\.com$|instagram\.com$|reddit\.com$|quora\.com$/i,
  /gardening|gardener|garden(?:ia|ing)?\w*\.(com|net)$/i,
  /shop|store|nursery|seeds?\.(com|net)$/i,
  /blogspot\.|medium\.com$|wordpress\.com$/i,
];

export function researchSourceDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** 0–100 authority score for an Identify-research source URL. */
export function identifyAuthorityScore(url: string): number {
  const host = researchSourceDomain(url);
  if (!host) return 10;
  for (const tier of AUTHORITY_TIERS) {
    if (tier.patterns.some((re) => re.test(host))) return tier.score;
  }
  if (DOWNRANK_PATTERNS.some((re) => re.test(host))) return 5;
  return 25;
}

/**
 * Sort research sources so authoritative botanical/taxonomic references appear
 * first; generic gardening/video/SEO pages fall to the bottom. Stable within
 * the same authority tier (preserves Tavily relevance order).
 */
export function rankIdentifyResearchSources<T extends { url?: string | null }>(
  sources: T[],
): Array<T & { authorityScore: number }> {
  return sources
    .map((s, index) => ({
      ...s,
      authorityScore: identifyAuthorityScore(s.url ?? ''),
      index,
    }))
    .sort((a, b) => b.authorityScore - a.authorityScore || a.index - b.index)
    .map(({ index: _index, ...rest }) => rest as T & { authorityScore: number });
}

// ---------------------------------------------------------------------------
// Income research (Increase Income cases)
//
// Income research must never guarantee profit, invent local prices/yields, or
// slip into chemical treatment guidance. The chemical scrubbing pipeline above
// is reused as-is; source ranking prefers extension/government/market sources.
// ---------------------------------------------------------------------------

export interface IncomeResearchContext {
  location?: string | null;
  cropContext?: string | null;
  notes?: string | null;
  family?: string | null;
  genus?: string | null;
}

/** Build the Tavily Research input for an Increase Income plant case. */
export function buildIncomeResearchInput(
  commonName: string | null | undefined,
  scientificName: string | null | undefined,
  lang: 'en' | 'sr',
  ctx: IncomeResearchContext = {},
): string {
  const common = commonName?.trim() || scientificName?.trim() || '';
  const scientific = scientificName?.trim() || common;
  const taxon = [ctx.genus?.trim(), ctx.family?.trim()].filter(Boolean).join(', ');
  const location = ctx.location?.trim();
  const crop = ctx.cropContext?.trim();
  const notes = ctx.notes?.trim();

  if (lang === 'sr') {
    const extra = [
      taxon ? `Taksonomija: ${taxon}.` : '',
      location ? `Lokacija: ${location}.` : '',
      crop ? `Kontekst gajenja: ${crop}.` : '',
      notes ? `Napomene korisnika: ${notes}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `Istraži kako se može povećati prihod od biljke ${common} (${scientific}). Fokusiraj se na praktične mogućnosti zarade, povećanje prinosa, vreme berbe, rukovanje posle berbe, proizvode sa dodatom vrednošću, pozicioniranje na tržištu, kanale prodaje, cenovne faktore, proizvodne rizike i realne sledeće korake za male proizvođače. Koristi samo potvrđenu biljku. Ako su dostupni lokacija ili kontekst gajenja, prilagodi smernice tom kontekstu. Ne navodi pesticide, fungicide, herbicide, doze, mešanje, raspored prskanja ili hemijska uputstva za tretman. Ne garantuj profit.${extra ? ` ${extra}` : ''} Ne izmišljaj lokalne cene ni prinose; ako podaci nisu dostupni, navedi to kao nedostatak podataka i predloži kako da se provere lokalno. Prioritet daj univerzitetskim savetodavnim službama, ministarstvima poljoprivrede i državnim izvorima, hortikulturnim i agronomskim institucijama, tržišnim izveštajima, asocijacijama proizvođača, izvorima o rukovanju posle berbe i pouzdanim vodičima za proizvodnju; izbegavaj opšte blogove, SEO baštenske stranice, prodajne stranice, forume i društvene mreže. Počni naslovom usmerenim na prihod, na primer: Mogućnosti prihoda od ${common} (${scientific}) — a ne botaničkim profilom. Struktuiraj odgovor tačno ovim naslovima: 1. Kratak pregled mogućnosti zarade, 2. Potvrđena biljka i proizvodni kontekst, 3. Glavni pravci prihoda, 4. Faktori prinosa i kvaliteta, 5. Berba i rukovanje posle berbe, 6. Proizvodi sa dodatom vrednošću, 7. Tržište i kanali prodaje, 8. Rizici i ograničenja, 9. Praktični sledeći koraci, 10. Nedostaci u dostupnim podacima. Počni odgovor direktno naslovom izveštaja — bez ponavljanja pitanja, zadatka ili napomena o jeziku i formatu.`;
  }

  const extra = [
    taxon ? `Taxonomy: ${taxon}.` : '',
    location ? `Location: ${location}.` : '',
    crop ? `Crop context: ${crop}.` : '',
    notes ? `User notes: ${notes}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `Research how income can be increased from ${common} (${scientific}). Focus on practical revenue opportunities, yield improvement, harvest timing, post-harvest handling, value-added products, market positioning, buyer channels, pricing considerations, production risks, and realistic next steps for small growers. Use the confirmed plant only. If location or crop context is available, adapt recommendations to that context. Do not provide pesticide/fungicide/herbicide product names, doses, mixing rates, spray schedules, or chemical treatment instructions. Do not guarantee profit.${extra ? ` ${extra}` : ''} Do not invent local prices or yield figures; when data is unavailable, list it as an evidence gap and explain how the grower can verify it locally. Prioritize university extension services, agriculture ministries and government agriculture sources, horticulture and agronomy institutions, market reports, grower associations, post-harvest and food-processing sources, and reputable crop production guides; avoid generic blogs, SEO gardening pages, ecommerce/product sales pages, forums, and social media. Start with a business-oriented report title such as: Income opportunities for ${common} (${scientific}) — not a botanical profile title. Structure the report with exactly these sections: 1. Income opportunity summary, 2. Confirmed plant and production context, 3. Main revenue paths, 4. Yield and quality levers, 5. Harvest and post-harvest handling, 6. Value-added products, 7. Market and buyer channels, 8. Risks and constraints, 9. Practical next steps, 10. Evidence gaps.`;
}

/** Remove profit guarantees from an income research answer. */
const PROFIT_GUARANTEE_PATTERNS: RegExp[] = [
  /\b(guaranteed|guarantees?|guarantee)\s+(profit|income|revenue|return)/i,
  /\bgarantovan\w*\s+(profit|prihod|zarad)/i,
  /\bsigurna\s+zarada\b/i,
];

export function scrubProfitGuarantees(markdown: string): string {
  if (!markdown) return markdown;
  return markdown
    .split('\n')
    .filter((line) => !(line.trim() && PROFIT_GUARANTEE_PATTERNS.some((re) => re.test(line))))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Full post-processing pipeline for Income research output. */
export function polishIncomeResearchAnswer(markdown: string): string {
  return normalizeResearchCitations(
    stripResearchPromptFraming(scrubProfitGuarantees(scrubTreatmentGuidance(markdown || ''))),
  );
}

const INCOME_AUTHORITY_TIERS: Array<{ score: number; patterns: RegExp[] }> = [
  {
    // University extension services
    score: 100,
    patterns: [/extension\./i, /\.extension\./i, /(\.|^)edu(\.[a-z]{2})?$/i, /(\.|^)ac\.[a-z]{2}$/i, /\.uni-/i],
  },
  {
    // Governments / agriculture ministries / intergovernmental bodies
    score: 90,
    patterns: [
      /(\.|^)gov(\.[a-z]{2})?$/i,
      /(\.|^)gov\./i,
      /usda\.gov$/i,
      /fao\.org$/i,
      /europa\.eu$/i,
      /minpolj|poljoprivreda/i,
    ],
  },
  {
    // Agronomy / horticulture institutes, market reports, grower associations
    score: 70,
    patterns: [
      /(^|\.)(ahdb|agmrc|rhs|cabi|icar|inra|inrae|wur|nifa)\./i,
      /research|institut|agronom|horticultur|postharvest|post-harvest/i,
      /market(?:s|report|data|news)|agrimarket|statist/i,
      /associat|coopera|growers?/i,
    ],
  },
];

const INCOME_DOWNRANK_PATTERNS: RegExp[] = [
  /youtube\.com$|youtu\.be$|vimeo\.com$|tiktok\.com$/i,
  /pinterest\.|facebook\.com$|instagram\.com$|reddit\.com$|quora\.com$|forum/i,
  /amazon\.|ebay\.|etsy\.|alibaba\.|shop|store|seeds?\.(com|net)$|nursery/i,
  /blogspot\.|medium\.com$|wordpress\.com$/i,
  /gardening|gardener|garden(?:ia|ing)?\w*\.(com|net)$/i,
];

/** 0–100 authority score for an income-research source URL. */
export function incomeAuthorityScore(url: string): number {
  const host = researchSourceDomain(url);
  if (!host) return 10;
  for (const tier of INCOME_AUTHORITY_TIERS) {
    if (tier.patterns.some((re) => re.test(host))) return tier.score;
  }
  if (INCOME_DOWNRANK_PATTERNS.some((re) => re.test(host))) return 5;
  return 30;
}

/** Sort income-research sources so extension/government/market sources lead. */
export function rankIncomeResearchSources<T extends { url?: string | null }>(
  sources: T[],
): Array<T & { authorityScore: number }> {
  return sources
    .map((s, index) => ({ ...s, authorityScore: incomeAuthorityScore(s.url ?? ''), index }))
    .sort((a, b) => b.authorityScore - a.authorityScore || a.index - b.index)
    .map(({ index: _index, ...rest }) => rest as T & { authorityScore: number });
}
