export const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
export const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);
export const quote = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Lower case without Latin accents, so "citta" finds "Città" and "cafe" finds "Café"; other scripts keep their marks. */
export const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase();

/** The words of a query in any script. A single Latin letter or digit is noise; a lone character of another script is a word. */
export const tokenize = (s: string): ReadonlyArray<string> =>
  fold(s)
    .split(/[^\p{L}\p{N}@._'-]+/u)
    .filter((t) => t.length > 1 || /[^\p{ASCII}]/u.test(t));

/** Cuts at a line boundary and says how much was left out. */
export function truncateText(text: string, maxChars: number, hint: string): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  return `${text.slice(0, cut > 0 ? cut : maxChars)}\n[truncated at ${maxChars} of ${text.length} chars; ${hint}]`;
}
