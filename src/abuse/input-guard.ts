/**
 * Garbage input detection. Spec §9 F7.
 *
 * Returns true when the text is likely spam/bot input based on:
 * - text.length > 100 AND
 * - fraction of uppercase letters to total letters > 0.7
 */

export function isGarbageInput(text: string): boolean {
  if (text.length <= 100) return false;

  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length === 0) return false;

  const upperCount = letters.replace(/[^A-Z]/g, "").length;
  return upperCount / letters.length > 0.7;
}
