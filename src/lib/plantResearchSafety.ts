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
    return `Istraži biljku ${label} za potrebe identifikacije. Fokusiraj se na taksonomiju, prihvaćene nazive, karakteristične osobine, slične vrste, prirodno rasprostranjenje, stanište, distribuciju, upotrebu i napomene, ekologiju i savete za proveru identifikacije. Uzgoj i rast navedi samo kao sekundarnu informaciju. Ne postavljaj dijagnozu bolesti i ne daj uputstva za tretman, hemijske preparate, doze ili raspored prskanja.`;
  }
  return `Research the plant ${label} for identification purposes. Focus on taxonomy, accepted names, distinguishing features, similar/confusable species, native range, habitat, distribution, uses/cautions, ecology, and verification tips. Treat cultivation/growth only as secondary information. Do not diagnose a plant disease and do not provide treatment instructions, chemical product names, doses, or spray schedules.`;
}
