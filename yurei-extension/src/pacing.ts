export type Point = { readonly x: number; readonly y: number };

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A delay that is always the same length is a fingerprint of its own, so every wait is spread around its nominal value. */
export const pause = (ms: number): Promise<void> => sleep(Math.round(ms * (0.75 + Math.random() * 0.65)));

const MAX_STEPS = 10;
const STEP_PX = 40;
const MAX_BOW_PX = 24;

/**
 * Points from the pointer's last position to `to` along an eased, slightly bowed path.
 * Jumping straight to the target leaves no mousemove trail, which both behavioural bot
 * detection and hover menus that expect the pointer to travel through them pick up on.
 */
export function movePath(from: Point | null, to: Point): ReadonlyArray<Point> {
  if (!from) return [to];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 8) return [to];

  const steps = Math.min(MAX_STEPS, Math.max(2, Math.round(distance / STEP_PX)));
  const bow = (Math.random() - 0.5) * Math.min(distance * 0.12, MAX_BOW_PX);
  const points: Point[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const eased = t * t * (3 - 2 * t);
    const arc = Math.sin(Math.PI * t) * bow;
    points.push({ x: from.x + dx * eased - (dy / distance) * arc, y: from.y + dy * eased + (dx / distance) * arc });
  }
  points.push(to);
  return points;
}

export type Turn = "action" | "load";
type Rate = { readonly burst: number; readonly refillMs: number };
type Bucket = { tokens: number; last: number };

// A page load costs a site far more than a click does, so loads run on their own slower clock.
const RATES: Readonly<Record<Turn, Rate>> = {
  action: { burst: 6, refillMs: 700 },
  load: { burst: 3, refillMs: 2000 },
};
// Search engines hand out captchas for a burst of result pages that a shop or a blog would not even notice.
const SEARCH_LOAD: Rate = { burst: 2, refillMs: 5000 };
const SEARCH_ENGINE =
  /^(?:google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|yandex\.[a-z]+|baidu\.com|brave\.com|ecosia\.org|startpage\.com|qwant\.com)$/i;
const rateFor = (kind: Turn, site: string): Rate =>
  kind === "load" && SEARCH_ENGINE.test(site) ? SEARCH_LOAD : RATES[kind];

const buckets = new Map<string, Bucket>();

// Enough of a public-suffix guess to keep "www.site.co.uk" and "shop.site.co.uk" on one budget.
const MULTI_LABEL_SUFFIX = /\.(?:com|co|net|org|ac|gov|edu|or|ne)\.[a-z]{2}$/i;
const LOCAL = /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|.+\.(?:localhost|local))$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The registrable domain a budget is keyed on, or "" for anything not worth pacing. */
export function siteOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  if (!host || LOCAL.test(host)) return "";
  if (IPV4.test(host) || !host.includes(".")) return host;
  return host
    .split(".")
    .slice(MULTI_LABEL_SUFFIX.test(host) ? -3 : -2)
    .join(".");
}

/**
 * Waits for this site's next turn, sleeping rather than failing when the budget is spent.
 * Rate limits and bans follow how many requests a host sees in a burst, not how fast any
 * single action is, so the budget is per site and per kind of work.
 */
export async function takeTurn(url: string, kind: Turn): Promise<void> {
  const site = siteOf(url);
  if (!site) return;
  const key = `${kind} ${site}`;
  const rate = rateFor(kind, site);

  for (;;) {
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: rate.burst, last: now };
    buckets.set(key, bucket);
    bucket.tokens = Math.min(rate.burst, bucket.tokens + (now - bucket.last) / rate.refillMs);
    bucket.last = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }
    await pause((1 - bucket.tokens) * rate.refillMs);
  }
}
