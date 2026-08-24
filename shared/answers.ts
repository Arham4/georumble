/**
 * Canonical answer normalization shared by the pack validator and the
 * typed-answer input, so a string the validator accepts as unique is exactly
 * the string the in-game resolver matches against.
 */
export function normalizeAnswer(text: string): string {
  return text.trim().toLowerCase().replaceAll(/[.,\-]/g, "");
}
