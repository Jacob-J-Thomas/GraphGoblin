/**
 * Loop-name equivalence (ADR-0073). Display spelling stays verbatim; compare names only
 * within the owner's visible loops. No Unicode normalization or full case folding.
 */
export function loopNameKey(name: string): string {
  return name.trim().replace(/\s+/gu, ' ').toLowerCase();
}
