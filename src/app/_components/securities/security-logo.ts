/**
 * Initials fallback for Security logos: deterministic from the name, no layout shift.
 * Colors are dark enough for white initials at WCAG AA contrast (≥ 4.5:1).
 */
export const LOGO_COLORS = [
  "#00695C",
  "#1565C0",
  "#6A1B9A",
  "#AD1457",
  "#B71C1C",
  "#4E342E",
  "#37474F",
  "#1B5E20",
] as const;

/** Up to two upper-case initials: first letters of the first two words, else the first two characters. */
export function securityInitials(name: string): string {
  const words = name.normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  const chars = words.length > 1 ? [...words[0]].slice(0, 1).concat([...words[1]].slice(0, 1)) : [...words[0]].slice(0, 2);
  return chars.join("").toLocaleUpperCase("de-DE");
}

/** Background color derived deterministically from the name (string hash → palette). */
export function securityColor(name: string): string {
  let hash = 0;
  for (const char of name.normalize("NFC")) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return LOGO_COLORS[hash % LOGO_COLORS.length];
}
