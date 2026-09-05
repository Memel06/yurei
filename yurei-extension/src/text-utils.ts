export const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
export const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);
export const quote = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Cuts at a line boundary and says how much was left out. */
export function truncateText(text: string, maxChars: number, hint: string): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  return `${text.slice(0, cut > 0 ? cut : maxChars)}\n[truncated at ${maxChars} of ${text.length} chars; ${hint}]`;
}
