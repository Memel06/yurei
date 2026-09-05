import { isRecord } from "../../shared/protocol";
import { ArgError } from "./args";
import {
  type FindHit,
  type FrameSelf,
  type FrameSlot,
  MAX_FIND_RESULTS,
  type PageMethod,
  type Rect,
  type TreeFilter,
  type Viewport,
} from "./page-api";
import { clip, errorMessage, quote, truncateText } from "./text-utils";

const MAX_FRAMES = 25;

/** Refs carry their frame so calls route without any state: ref_7 lives in the top frame, frame12_ref_7 in frame 12. */
const REF = /^(?:frame(\d+)_)?(ref_\d+)$/;
export const frameOfRef = (ref: string): number => {
  const match = REF.exec(ref.trim());
  return match?.[1] ? Number(match[1]) : 0;
};
export const localRef = (ref: string): string => REF.exec(ref.trim())?.[2] ?? ref.trim();
const qualifyRef = (ref: string, frameId: number): string => (frameId === 0 ? ref : `frame${frameId}_${ref}`);
export const qualifyText = (text: string, frameId: number): string =>
  frameId === 0 ? text : text.replace(/\[ref_(\d+)\]/g, `[frame${frameId}_ref_$1]`);

export const fieldString = (record: Record<string, unknown>, key: string): string => {
  const v = record[key];
  return typeof v === "string" ? v : "";
};

export const fieldNumber = (record: Record<string, unknown>, key: string): number => {
  const v = record[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

// Serialized into the frame by executeScript, so it must only touch its arguments and window.
const invoke = (name: string, callArgs: unknown[]): unknown => {
  const api = window.__yurei;
  if (!api) return { ok: false, error: "Yurei page tools are not available on this page" };
  const fn: unknown = Reflect.get(api, name);
  return typeof fn === "function"
    ? Reflect.apply(fn, api, callArgs)
    : { ok: false, error: `Unknown page method ${name}` };
};

async function inject(
  target: chrome.scripting.InjectionTarget,
  method: PageMethod,
  params: ReadonlyArray<unknown>,
  withFile: boolean,
): Promise<ReadonlyArray<chrome.scripting.InjectionResult>> {
  if (withFile) await chrome.scripting.executeScript({ target, files: ["content/page-tools.js"] });
  return chrome.scripting.executeScript({ target, func: invoke, args: [method, [...params]] });
}

function unwrap(result: unknown, method: PageMethod): Record<string, unknown> {
  if (!isRecord(result)) throw new Error(`The page returned nothing for ${method}`);
  if (result["ok"] !== true) throw new Error(fieldString(result, "error") || `${method} failed`);
  return result;
}

const GONE = "The iframe holding this ref is no longer on the page. Call read_page or find again for fresh refs.";

export async function callPage(
  tabId: number,
  frameId: number,
  method: PageMethod,
  params: ReadonlyArray<unknown>,
): Promise<Record<string, unknown>> {
  try {
    const [first] = await inject({ tabId, frameIds: [frameId] }, method, params, true);
    return unwrap(first?.result, method);
  } catch (e) {
    if (/No frame with id/i.test(errorMessage(e))) throw new ArgError(GONE);
    throw e;
  }
}

const rectOf = (v: unknown): Rect | null =>
  isRecord(v)
    ? {
        x: fieldNumber(v, "x"),
        y: fieldNumber(v, "y"),
        width: fieldNumber(v, "width"),
        height: fieldNumber(v, "height"),
      }
    : null;

function slotsOf(data: Record<string, unknown>): ReadonlyArray<FrameSlot> {
  const raw = data["frames"];
  if (!Array.isArray(raw)) return [];
  const slots: FrameSlot[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const box = rectOf(item["box"]);
    const ref = item["ref"];
    if (!box || typeof ref !== "string") continue;
    slots.push({
      ref,
      depth: fieldNumber(item, "depth"),
      label: fieldString(item, "label"),
      box,
      src: fieldString(item, "src"),
      name: fieldString(item, "name"),
    });
  }
  return slots;
}

export function viewportOf(data: Record<string, unknown>): Viewport {
  const v = data["viewport"];
  return isRecord(v) ? { width: fieldNumber(v, "width"), height: fieldNumber(v, "height") } : { width: 0, height: 0 };
}

const selfOf = (data: Record<string, unknown>): FrameSelf | null => {
  const v = data["self"];
  return isRecord(v)
    ? {
        href: fieldString(v, "href"),
        name: fieldString(v, "name"),
        width: fieldNumber(v, "width"),
        height: fieldNumber(v, "height"),
      }
    : null;
};

function hitsOf(data: Record<string, unknown>): ReadonlyArray<FindHit> {
  const raw = data["hits"];
  if (!Array.isArray(raw)) return [];
  const hits: FindHit[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item["ref"] !== "string") continue;
    const href = item["href"];
    hits.push({
      ref: item["ref"],
      role: fieldString(item, "role"),
      name: fieldString(item, "name"),
      href: typeof href === "string" ? href : null,
      inView: item["inView"] === true,
      score: fieldNumber(item, "score"),
    });
  }
  return hits;
}

export type FrameInfo = {
  readonly frameId: number;
  readonly parentFrameId: number;
  /** The iframe element in the parent document that hosts this frame; null for the top frame or when unknown. */
  readonly slot: FrameSlot | null;
  readonly viewport: Viewport | null;
  readonly error: string | null;
};

export type FrameMap = {
  readonly byId: ReadonlyMap<number, FrameInfo>;
  readonly childOfSlot: ReadonlyMap<string, number>;
};

const slotKey = (parentFrameId: number, ref: string): string => `${parentFrameId}:${ref}`;
const stripHash = (url: string): string => url.split("#")[0] ?? url;

/**
 * Chrome tells us which frames exist and who their parents are, but not which iframe element hosts which frame.
 * A frame's own URL, window.name and viewport size identify its iframe; ties fall back to DOM order, and a frame that
 * matches no iframe on any of them stays unmapped rather than taking the first free one.
 */
function matchSlot(self: FrameSelf, slots: ReadonlyArray<FrameSlot>, taken: ReadonlySet<string>): FrameSlot | null {
  let best: FrameSlot | null = null;
  let bestScore = 0;
  for (const slot of slots) {
    if (taken.has(slot.ref)) continue;
    let score = 0;
    if (slot.src === self.href) score += 4;
    else if (stripHash(slot.src) === stripHash(self.href)) score += 3;
    if (self.name && slot.name === self.name) score += 3;
    if (Math.abs(slot.box.width - self.width) <= 2 && Math.abs(slot.box.height - self.height) <= 2) score += 2;
    if (score > bestScore) {
      best = slot;
      bestScore = score;
    }
  }
  return best;
}

const NOT_SCRIPTABLE = "frame is not scriptable";

async function mapFrames(tabId: number): Promise<FrameMap> {
  const nodes = ((await chrome.webNavigation.getAllFrames({ tabId })) ?? [])
    .filter((n) => n.documentLifecycle === "active" && n.frameType !== "fenced_frame")
    // Frame ids grow with creation, so parents come before children and siblings keep DOM order.
    .sort((a, b) => a.frameId - b.frameId)
    .slice(0, MAX_FRAMES);
  const described = new Map<number, Record<string, unknown>>();
  for (const injection of await inject({ tabId, allFrames: true }, "frames", [null], true)) {
    try {
      described.set(injection.frameId, unwrap(injection.result, "frames"));
    } catch {
      // Not scriptable (error page, another extension's frame): reported per frame below.
    }
  }
  const byId = new Map<number, FrameInfo>();
  const childOfSlot = new Map<string, number>();
  const taken = new Map<number, Set<string>>();
  for (const node of nodes) {
    const own = described.get(node.frameId);
    const viewport = own ? viewportOf(own) : null;
    if (node.parentFrameId < 0) {
      byId.set(node.frameId, {
        frameId: node.frameId,
        parentFrameId: -1,
        slot: null,
        viewport,
        error: own ? null : NOT_SCRIPTABLE,
      });
      continue;
    }
    const parent = described.get(node.parentFrameId);
    const self = own ? selfOf(own) : null;
    const claimed = taken.get(node.parentFrameId) ?? new Set<string>();
    taken.set(node.parentFrameId, claimed);
    const slot = parent && self ? matchSlot(self, slotsOf(parent), claimed) : null;
    if (slot) {
      claimed.add(slot.ref);
      childOfSlot.set(slotKey(node.parentFrameId, slot.ref), node.frameId);
    }
    const error = !own
      ? NOT_SCRIPTABLE
      : !parent
        ? "parent frame is not scriptable"
        : !slot
          ? "could not tell which iframe hosts it"
          : null;
    byId.set(node.frameId, { frameId: node.frameId, parentFrameId: node.parentFrameId, slot, viewport, error });
  }
  return { byId, childOfSlot };
}

export type FrameResult = {
  readonly frameId: number;
  readonly slot: FrameSlot | null;
  readonly data: Record<string, unknown> | null;
  readonly error: string | null;
};

export type Walk = { readonly map: FrameMap; readonly results: ReadonlyArray<FrameResult> };

const intersect = (a: Rect, b: Rect): Rect => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
};

/** Runs a page method in the top frame and every identified iframe, telling each frame which part of it is on screen. */
export async function walkFrames(
  tabId: number,
  method: PageMethod,
  paramsFor: (clip: Rect | null) => ReadonlyArray<unknown>,
): Promise<Walk> {
  const map = await mapFrames(tabId);
  const top = map.byId.get(0);
  if (!top || top.error) throw new Error(`Cannot read this page: ${top?.error ?? "no top frame"}`);

  // Visible part of each frame in its own coordinates, computed parents first.
  const clips = new Map<number, Rect | null>([[0, null]]);
  for (const info of map.byId.values()) {
    if (!info.slot) continue;
    const parent = map.byId.get(info.parentFrameId);
    const parentVisible =
      clips.get(info.parentFrameId) ?? (parent?.viewport ? { x: 0, y: 0, ...parent.viewport } : null);
    const shown = parentVisible
      ? intersect(parentVisible, info.slot.box)
      : { x: info.slot.box.x, y: info.slot.box.y, width: 0, height: 0 };
    clips.set(info.frameId, {
      x: shown.x - info.slot.box.x,
      y: shown.y - info.slot.box.y,
      width: shown.width,
      height: shown.height,
    });
  }

  const results = await Promise.all(
    [...map.byId.values()]
      .filter((info) => info.frameId === 0 || info.slot !== null)
      .map(async (info): Promise<FrameResult> => {
        try {
          // mapFrames injected the page tools into every frame a moment ago.
          const [first] = await inject(
            { tabId, frameIds: [info.frameId] },
            method,
            paramsFor(clips.get(info.frameId) ?? null),
            false,
          );
          return { frameId: info.frameId, slot: info.slot, data: unwrap(first?.result, method), error: null };
        } catch (e) {
          return { frameId: info.frameId, slot: info.slot, data: null, error: errorMessage(e) };
        }
      }),
  );
  const topResult = results.find((r) => r.frameId === 0);
  if (topResult?.error) throw new Error(topResult.error);
  return { map, results };
}

/** Splices each frame's outline under the iframe line that hosts it, indented one level deeper. */
export function composeTree({ map, results }: Walk, filter: TreeFilter): string {
  const byFrame = new Map(results.map((r) => [r.frameId, r]));
  const render = (frame: FrameResult): string[] => {
    if (!frame.data) return [];
    const lines = qualifyText(fieldString(frame.data, "text"), frame.frameId)
      .split("\n")
      .filter((line) => line.length > 0);
    for (const slot of slotsOf(frame.data)) {
      const marker = `[${qualifyRef(slot.ref, frame.frameId)}]`;
      const index = lines.findIndex((line) => line.includes(marker));
      if (index < 0) continue;
      const childId = map.childOfSlot.get(slotKey(frame.frameId, slot.ref));
      const child = childId === undefined ? undefined : byFrame.get(childId);
      const inner = child ? render(child) : [];
      if (inner.length > 0) {
        lines.splice(index + 1, 0, ...inner.map((line) => `${" ".repeat(slot.depth + 1)}${line}`));
        continue;
      }
      if (child?.data) {
        // Reachable but nothing worth listing: an empty iframe line is just noise in the interactive outline.
        if (filter === "interactive") lines.splice(index, 1);
        continue;
      }
      lines[index] =
        `${lines[index] ?? ""} (contents not accessible: ${clip(child?.error ?? NOT_SCRIPTABLE, 100)}; click inside it by coordinate)`;
    }
    return lines;
  };
  const top = byFrame.get(0);
  return top ? render(top).join("\n") : "";
}

export function composeFind({ results }: Walk, query: string): string {
  type Located = FindHit & { readonly where: string };
  const hits: Located[] = [];
  let total = 0;
  for (const r of results) {
    if (!r.data) continue;
    total += fieldNumber(r.data, "total");
    for (const hit of hitsOf(r.data))
      hits.push({ ...hit, ref: qualifyRef(hit.ref, r.frameId), where: r.slot?.label ?? "" });
  }
  if (hits.length === 0) return `No elements match "${query}". Try different words, or use read_page to list the page.`;
  hits.sort((a, b) => b.score - a.score);
  const lines = hits.slice(0, MAX_FIND_RESULTS).map((h) => {
    const parts = [h.role, quote(clip(h.name, 100)), `[${h.ref}]`, h.inView ? "(visible)" : "(needs scrolling)"];
    if (h.href) parts.push(`href=${quote(clip(h.href, 100))}`);
    if (h.where) parts.push(`(inside iframe ${h.where})`);
    return parts.join(" ");
  });
  const header =
    total > MAX_FIND_RESULTS
      ? `${total} matches, showing the best ${MAX_FIND_RESULTS} (refine the query for fewer):`
      : `${total} match${total === 1 ? "" : "es"}:`;
  return `${header}\n${lines.join("\n")}`;
}

/** Frame texts in document order: each iframe's text follows its parent's, headed by the chain of iframe labels. */
export function composeText({ map, results }: Walk, maxChars: number): string {
  const byFrame = new Map(results.map((r) => [r.frameId, r]));
  const parts: string[] = [];
  const visit = (frameId: number, path: ReadonlyArray<string>): void => {
    const r = byFrame.get(frameId);
    const text = r?.data ? fieldString(r.data, "text") : "";
    if (text) parts.push(path.length > 0 ? `--- iframe ${path.join(" > ")} ---\n${text}` : text);
    const children = [...map.byId.values()]
      .filter((f) => f.parentFrameId === frameId)
      .sort((a, b) => a.frameId - b.frameId);
    for (const child of children) if (child.slot) visit(child.frameId, [...path, child.slot.label]);
  };
  visit(0, []);
  return truncateText(parts.join("\n\n"), maxChars, "pass a larger max_chars");
}

export type Offset = { readonly x: number; readonly y: number };
/** The iframes between the top frame and a frame, outermost first: each entry is an iframe ref inside its parent frame. */
export type FrameChain = ReadonlyArray<{ readonly parentFrameId: number; readonly ref: string }>;

export async function frameChain(tabId: number, frameId: number): Promise<FrameChain> {
  if (frameId === 0) return [];
  const map = await mapFrames(tabId);
  const chain: { parentFrameId: number; ref: string }[] = [];
  for (let id = frameId; id !== 0 && chain.length <= MAX_FRAMES; ) {
    const info = map.byId.get(id);
    if (!info?.slot) throw new ArgError(GONE);
    chain.unshift({ parentFrameId: info.parentFrameId, ref: info.slot.ref });
    id = info.parentFrameId;
  }
  return chain;
}

/** Top-frame viewport position of the chain's innermost frame, scrolling each hosting iframe into view on the way. */
export async function chainOffset(tabId: number, chain: FrameChain): Promise<Offset> {
  let x = 0;
  let y = 0;
  for (const link of chain) {
    const data = await callPage(tabId, link.parentFrameId, "frames", [link.ref]);
    const box = slotsOf(data).find((s) => s.ref === link.ref)?.box;
    if (!box) throw new ArgError(GONE);
    x += box.x;
    y += box.y;
  }
  return { x, y };
}
