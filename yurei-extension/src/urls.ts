const FULL_URL = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:about|data|javascript|mailto|blob|view-source):)/i;
const HOST_URL = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})(?::\d{1,5})?(?:[/?#]|$)/i;
const LOCAL_HOST = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Full URLs pass through; hosts get a scheme (http for localhost and IP literals); anything else becomes a search. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (FULL_URL.test(trimmed)) return trimmed;
  const host = HOST_URL.exec(trimmed)?.[1];
  if (host) return `${LOCAL_HOST.test(host) ? "http" : "https"}://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
