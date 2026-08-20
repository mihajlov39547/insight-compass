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

/**
 * Compact, human-readable summary of the Permapeople profile, used as extra
 * grounding context inside research prompts. Permapeople is community data:
 * it supports cultivation / use framing only, never diagnosis or chemicals.
 */
export function buildPermapeopleContextLine(
  profile:
    | {
        scientific_name?: string | null;
        common_name?: string | null;
        family?: string | null;
        match_confidence?: string | null;
        normalized_data?: Record<string, any> | null;
      }
    | null
    | undefined,
  lang: 'en' | 'sr',
): string | null {
  if (!profile) return null;
  const nd = profile.normalized_data ?? {};
  const pairs: Array<[string, string, unknown]> = [
    ['Water', 'Voda', nd.waterRequirement],
    ['Light', 'Svetlo', nd.lightRequirement],
    ['Soil', 'Zemljište', nd.soilType],
    ['Hardiness', 'Zona otpornosti', nd.hardinessZone],
    ['Growth', 'Rast', nd.growth],
    ['Layer', 'Sloj', nd.layer],
    ['Edible', 'Jestiva', nd.edible],
    ['Edible parts', 'Jestivi delovi', nd.edibleParts],
    ['Edible uses', 'Jestive upotrebe', nd.edibleUses],
    ['Life cycle', 'Životni ciklus', nd.lifeCycle],
    ['Days to harvest', 'Dana do berbe', nd.daysToHarvest],
    ['Propagation', 'Razmnožavanje', nd.propagationMethod],
    ['Soil pH', 'pH zemljišta', nd.soilPh],
    ['Spacing', 'Rastojanje', nd.spacing],
    ['Utility', 'Namena', nd.utility],
  ];
  const facts = pairs
    .filter(([, , v]) => typeof v === 'string' && v.trim())
    .map(([en, sr, v]) => `${lang === 'sr' ? sr : en}: ${String(v).trim()}`);
  const name = [profile.common_name, profile.scientific_name].filter(Boolean).join(' / ');
  if (!facts.length && !name) return null;
  const approximate = profile.match_confidence && profile.match_confidence !== 'high';

  if (lang === 'sr') {
    return `Permapeople referentni podaci (zajednički doprinos korisnika, koristi samo kao sekundarni kontekst za gajenje i upotrebu, ne za dijagnozu)${
      approximate ? ' — poklapanje je približno' : ''
    }: ${[name, ...facts].filter(Boolean).join('; ')}.`;
  }
  return `Permapeople reference data (community-maintained; use only as secondary cultivation/use context, never for diagnosis)${
    approximate ? ' — match is approximate' : ''
  }: ${[name, ...facts].filter(Boolean).join('; ')}.`;
}

export interface IncomeResearchContext {
  location?: string | null;
  cropContext?: string | null;
  notes?: string | null;
  family?: string | null;
  genus?: string | null;
  permapeopleContext?: string | null;
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
      ctx.permapeopleContext?.trim() || '',
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
    ctx.permapeopleContext?.trim() || '',
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

// ---------------------------------------------------------------------------
// Problem research (Diagnose problem cases)
//
// Problem research may cover safe, high-level treatment CATEGORIES (sanitation,
// monitoring, cultural/mechanical controls, escalation to local professionals)
// but never chemical specifics: product names, active ingredients, doses,
// mixing rates, application rates, or spray schedules. It must also never
// promise a cure.
// ---------------------------------------------------------------------------

export interface ProblemResearchContext {
  problemType?: string | null;
  provider?: string | null;
  confidenceScore?: number | null;
  confidenceBucket?: string | null;
  plantRelevance?: string | null;
  plantRelevanceReason?: string | null;
  affectedOrgans?: string[] | null;
  location?: string | null;
  cropContext?: string | null;
  notes?: string | null;
  permapeopleContext?: string | null;
}

/** Build the Tavily Research input for a Diagnose problem plant case. */
export function buildProblemResearchInput(
  problemName: string | null | undefined,
  scientificProblemName: string | null | undefined,
  plantCommonName: string | null | undefined,
  plantScientificName: string | null | undefined,
  lang: 'en' | 'sr',
  ctx: ProblemResearchContext = {},
): string {
  const problem = problemName?.trim() || scientificProblemName?.trim() || '';
  const problemSci =
    scientificProblemName?.trim() && scientificProblemName.trim() !== problem
      ? scientificProblemName.trim()
      : '';
  const plantCommon = plantCommonName?.trim() || plantScientificName?.trim() || '';
  const plantSci = plantScientificName?.trim() || plantCommon;
  const organs = (ctx.affectedOrgans ?? []).filter(Boolean).join(', ');

  if (lang === 'sr') {
    const extra = [
      ctx.problemType ? `Tip problema: ${ctx.problemType}.` : '',
      ctx.provider ? `Izvor kandidata: ${ctx.provider}.` : '',
      typeof ctx.confidenceScore === 'number'
        ? `Pouzdanost: ${Math.round(ctx.confidenceScore * 100)}%${ctx.confidenceBucket ? ` (${ctx.confidenceBucket})` : ''}.`
        : ctx.confidenceBucket
          ? `Pouzdanost: ${ctx.confidenceBucket}.`
          : '',
      ctx.plantRelevance ? `Relevantnost za biljku: ${ctx.plantRelevance}.` : '',
      ctx.plantRelevanceReason ? `Napomena o relevantnosti: ${ctx.plantRelevanceReason}.` : '',
      organs ? `Zahvaćeni organi: ${organs}.` : '',
      ctx.location ? `Lokacija: ${ctx.location}.` : '',
      ctx.cropContext ? `Kontekst gajenja: ${ctx.cropContext}.` : '',
      ctx.notes ? `Napomene korisnika: ${ctx.notes}.` : '',
      ctx.permapeopleContext?.trim() || '',
    ]
      .filter(Boolean)
      .join(' ');
    return `Istraži potvrđeni problem biljke ${problem}${problemSci ? ` (${problemSci})` : ''} u vezi sa potvrđenom biljkom ${plantCommon} (${plantSci}). Fokusiraj se na proveru dijagnoze, tipične simptome, zahvaćene organe, relevantnost za biljku domaćina, životni ciklus ili uzročne faktore, uslove koji pogoduju problemu, nehemijsku prevenciju, sanitaciju, praćenje, agrotehničke mere, mehaničke/fizičke mere, biološke ili niskorizične opcije kada su potkrepljene izvorima, kada tražiti lokalnu stručnu pomoć i koje kategorije tretmana mogu doći u obzir. Ne navodi nazive pesticida, fungicida, herbicida, preporuke aktivnih materija, doze, mešanje, raspored prskanja ili hemijska uputstva za primenu. Ako izvori pominju hemijsku kontrolu, sažmi samo na visokom nivou kao: “regulisane hemijske opcije mogu postojati; konsultujte lokalnu savetodavnu službu ili licencirane stručnjake.” Ne predstavljaj tretman kao garantovan. Ako je pouzdanost dijagnoze niska ili je relevantnost za biljku nepoznata, jasno navedi da su smernice privremene i zahtevaju lokalnu proveru.${extra ? ` ${extra}` : ''} Prioritet daj univerzitetskim savetodavnim službama, državnim poljoprivrednim institucijama, izvorima o integralnoj zaštiti bilja (IPM), institutima za fitopatologiju i entomologiju, EPPO, CABI, USDA, FAO i nacionalnim organizacijama za zaštitu bilja; izbegavaj opšte blogove, SEO baštenske stranice, prodajne stranice, forume, društvene mreže i video sadržaj osim ako ne postoji bolji izvor. Struktuiraj odgovor tačno ovim naslovima: 1. Kratak pregled problema, 2. Pouzdanost dijagnoze i ograničenja dokaza, 3. Potvrđena biljka i relevantnost domaćina, 4. Simptomi i zahvaćeni organi, 5. Životni ciklus ili uzročni faktori, 6. Uslovi koji pogoduju problemu, 7. Praćenje i koraci za proveru, 8. Nehemijska prevencija i sanitacija, 9. Kategorije tretmana i eskalacija, 10. Kada tražiti lokalnu stručnu pomoć, 11. Nedostaci u dostupnim podacima. Počni odgovor direktno naslovom izveštaja — bez ponavljanja pitanja, zadatka ili napomena o jeziku i formatu.`;
  }

  const extra = [
    ctx.problemType ? `Problem type: ${ctx.problemType}.` : '',
    ctx.provider ? `Candidate provider: ${ctx.provider}.` : '',
    typeof ctx.confidenceScore === 'number'
      ? `Confidence: ${Math.round(ctx.confidenceScore * 100)}%${ctx.confidenceBucket ? ` (${ctx.confidenceBucket})` : ''}.`
      : ctx.confidenceBucket
        ? `Confidence: ${ctx.confidenceBucket}.`
        : '',
    ctx.plantRelevance ? `Plant relevance: ${ctx.plantRelevance}.` : '',
    ctx.plantRelevanceReason ? `Relevance note: ${ctx.plantRelevanceReason}.` : '',
    organs ? `Affected organs: ${organs}.` : '',
    ctx.location ? `Location: ${ctx.location}.` : '',
    ctx.cropContext ? `Crop context: ${ctx.cropContext}.` : '',
    ctx.notes ? `User notes: ${ctx.notes}.` : '',
    ctx.permapeopleContext?.trim() || '',
  ]
    .filter(Boolean)
    .join(' ');
  return `Research the confirmed plant problem ${problem}${problemSci ? ` (${problemSci})` : ''} in relation to the confirmed plant ${plantCommon} (${plantSci}). Focus on diagnosis verification, typical symptoms, affected organs, host relevance, life cycle or causal factors, conditions that favor the problem, non-chemical prevention, sanitation, monitoring, cultural controls, mechanical/physical controls, biological or low-risk options where supported, when to seek local expert help, and what treatment categories may be considered. Do not provide pesticide/fungicide/herbicide product names, active ingredient recommendations, doses, mixing rates, spray schedules, or chemical application instructions. If chemical control is commonly discussed by sources, summarize only at a high level as “regulated chemical options may exist; consult local extension or licensed professionals.” Do not present treatment as guaranteed. If diagnosis confidence is low or plant relevance is unknown, state that recommendations are provisional and require local confirmation.${extra ? ` ${extra}` : ''} Prioritize university extension services, government agriculture agencies, integrated pest management (IPM) programs, plant pathology and entomology institutions, EPPO, CABI, USDA, FAO, national plant protection organizations, and reputable horticulture/agronomy institutes; avoid generic blogs, SEO gardening pages, ecommerce or pesticide sales pages, forums, social media, and video pages unless no better source exists. Structure the report with exactly these sections: 1. Problem summary, 2. Diagnosis confidence and evidence limits, 3. Confirmed plant and host relevance, 4. Symptoms and affected organs, 5. Life cycle or causal factors, 6. Conditions that favor the problem, 7. Monitoring and verification steps, 8. Non-chemical prevention and sanitation, 9. Treatment categories and escalation, 10. When to seek local expert help, 11. Evidence gaps. Start the answer directly with the report title — do not restate the question, the task, or notes about language or formatting.`;
}

/** Chemical specifics and guaranteed-cure claims that must never be shown. */
const CHEMICAL_SPECIFIC_PATTERNS: RegExp[] = [
  /\b(active ingredient|a\.i\.)\b/i,
  /\baktivn\w*\s+(materij|sastoj)/i,
  /\b(application rate|rate of application|norma primene|norma\s+trošenja)/i,
  /\b(spray\s*(interval|schedule|program|timing)|raspored\s+prskanja|interval\s+prskanja)/i,
  /\b(mix(ing)?\s*(rate|ratio)|tank\s*mix|mešanje\s+rastvora)/i,
  /\b\d+(?:[.,]\d+)?\s?(?:%|ml|l|g|kg|oz|lb)\s*(?:\/|per|na)\s*(?:l|liter|litre|litar|ha|acre|gal|gallon|100\s?l|m2|m²)\b/i,
  /\b(apply|primeni|primenite|koristi(te)?)\b[^.]{0,60}\b(pesticid|fungicid|insekticid|herbicid|pesticide|fungicide|insecticide|herbicide)/i,
  /\b(guaranteed|guarantees?)\s+(cure|control|eradicat|treatment)/i,
  /\b(garantovan\w*)\s+(izlečenj|lečenj|kontrol|tretman|suzbijanj)/i,
  /\bwill\s+(completely\s+)?(cure|eradicate)\b/i,
  /\b(neem oil|copper fungicide|bordeaux|bordovska|sulfur spray|imidacloprid|carbaryl|spinosad|mancozeb|chlorothalonil|glyphosate|glifosat)\b/i,
];

/** Remove chemical specifics and guaranteed-cure claims line-by-line. */
export function scrubChemicalSpecifics(markdown: string): string {
  if (!markdown) return markdown;
  return markdown
    .split('\n')
    .filter((line) => !(line.trim() && CHEMICAL_SPECIFIC_PATTERNS.some((re) => re.test(line))))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Post-processing for Problem research output.
 *
 * NOTE: unlike Identify/Income research, the broad `scrubTreatmentGuidance`
 * section-dropping is intentionally NOT applied here — Diagnose research is
 * allowed to discuss safe treatment CATEGORIES. Chemical specifics are removed
 * by `scrubChemicalSpecifics` instead.
 */
export function polishProblemResearchAnswer(markdown: string): string {
  return normalizeResearchCitations(
    stripResearchPromptFraming(scrubChemicalSpecifics(markdown || '')),
  );
}

const PROBLEM_AUTHORITY_TIERS: Array<{ score: number; patterns: RegExp[] }> = [
  {
    // University extension & IPM programs
    score: 100,
    patterns: [/extension\./i, /\bipm\b|ipm\./i, /(\.|^)edu(\.[a-z]{2})?$/i, /(\.|^)ac\.[a-z]{2}$/i, /\.uni-/i],
  },
  {
    // Government agriculture, plant protection & intergovernmental bodies
    score: 90,
    patterns: [
      /(\.|^)gov(\.[a-z]{2})?$/i,
      /(\.|^)gov\./i,
      /eppo\.int$|eppo\./i,
      /cabi\.org$|cabidigitallibrary/i,
      /usda\.gov$|aphis\.usda/i,
      /fao\.org$/i,
      /europa\.eu$|efsa\.europa/i,
      /minpolj|zastitabilja|plantprotection|nppo/i,
    ],
  },
  {
    // Plant pathology / entomology / horticulture institutions & advisory bodies
    score: 70,
    patterns: [
      /(^|\.)(apsnet|entsoc|rhs|ahdb|inrae|inra|wur|csiro|jki|adas)\./i,
      /phytopath|patholog|entomolog|institut|research|horticultur|agronom/i,
      /advisor|savetodav|agroservis/i,
    ],
  },
];

const PROBLEM_DOWNRANK_PATTERNS: RegExp[] = [
  /youtube\.com$|youtu\.be$|vimeo\.com$|tiktok\.com$/i,
  /pinterest\.|facebook\.com$|instagram\.com$|reddit\.com$|quora\.com$|forum/i,
  /amazon\.|ebay\.|etsy\.|alibaba\.|shop|store|seeds?\.(com|net)$|nursery|pesticide|agrochem/i,
  /blogspot\.|medium\.com$|wordpress\.com$/i,
  /gardening|gardener|garden(?:ia|ing)?\w*\.(com|net)$/i,
];

/** 0–100 authority score for a problem-research source URL. */
export function problemAuthorityScore(url: string): number {
  const host = researchSourceDomain(url);
  if (!host) return 10;
  for (const tier of PROBLEM_AUTHORITY_TIERS) {
    if (tier.patterns.some((re) => re.test(host))) return tier.score;
  }
  if (PROBLEM_DOWNRANK_PATTERNS.some((re) => re.test(host))) return 5;
  return 30;
}

/** Sort problem-research sources so extension/government/IPM sources lead. */
export function rankProblemResearchSources<T extends { url?: string | null }>(
  sources: T[],
): Array<T & { authorityScore: number }> {
  return sources
    .map((s, index) => ({ ...s, authorityScore: problemAuthorityScore(s.url ?? ''), index }))
    .sort((a, b) => b.authorityScore - a.authorityScore || a.index - b.index)
    .map(({ index: _index, ...rest }) => rest as T & { authorityScore: number });
}
