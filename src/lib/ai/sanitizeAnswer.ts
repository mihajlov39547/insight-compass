/**
 * Removes trailing bibliography-like blocks from assistant answers so the
 * dedicated "Sources" UI box remains the single source of truth.
 *
 * Conservative — only strips trailing References/Sources sections, never touches
 * normal answer content above them.
 */

// Heading line such as:
//   "References", "## References", "**References**",
//   "References — web", "Sources used:", "## Sources"
const HEADING_REGEX =
  /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(references|sources(?:\s+used)?)\b[^\n]*?(?:\*\*|__)?\s*:?\s*$/i;

// Common bibliography-row patterns. If any of these appear in the candidate
// trailing block, we treat the block as a bibliography and strip it.
const BIB_ROW_PATTERNS: RegExp[] = [
  /^\s*[-*]?\s*\[\d+\]\s*https?:\/\//im,            // [1] http...
  /^\s*\d+\.\s*https?:\/\//im,                       // 1. http...
  /^\s*[-*]\s*https?:\/\//im,                        // - http://...
  /^\s*Language\s*:/im,                              // Language: en
  /^\s*Annotation\s*:/im,                            // Annotation: ...
  /^\s*Reliability(?:\s*\/\s*confidence)?\s*:/im,    // Reliability/confidence: ...
  /^\s*Source\s*\d+\s*:/im,                          // Source 1: ...
];

export function sanitizeAssistantAnswerForDisplay(answer: string): string {
  if (!answer || typeof answer !== 'string') return answer ?? '';

  const lines = answer.split('\n');

  // Walk from the end, find the last heading line that matches References/Sources.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!HEADING_REGEX.test(line)) continue;

    // Candidate trailing block = everything from this heading to EOF.
    const tail = lines.slice(i + 1).join('\n');

    // Empty tail under a "Sources" heading — also strip the dangling heading.
    const tailTrimmed = tail.trim();
    if (tailTrimmed.length === 0) {
      return lines.slice(0, i).join('\n').replace(/\s+$/, '');
    }

    // If the tail contains any bibliography-row marker, strip from heading down.
    const looksLikeBib = BIB_ROW_PATTERNS.some((re) => re.test(tail));
    if (looksLikeBib) {
      return lines.slice(0, i).join('\n').replace(/\s+$/, '');
    }

    // Heading found but tail doesn't look like a bibliography — leave content.
    break;
  }

  return answer;
}
