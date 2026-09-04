import { COMPUTER_ACTIONS, type Args, type ToolName, type ToolResult, errorResult, isRecord, textResult } from "../../shared/protocol";
import { ArgError, optBoolean, optCoordinate, optEnum, optNumber, optString, reqEnum, reqNumber, reqString, type Coordinate } from "./args";
import { errorMessage, sessions, type TabSession } from "./cdp";
import { callPage, chainOffset, composeFind, composeText, composeTree, fieldNumber, fieldString, frameChain, frameOfRef, localRef, qualifyText, viewportOf, walkFrames } from "./frames";
import { hideForCapture, markActive, moveCursor, showAfterCapture } from "./indicator";
import { MOD, parseKeyPress } from "./keys";
import { createOwnWindow, ownTabs, ownWindowId } from "./own-window";
import { movePath, pause, siteOf, sleep, takeTurn, type Point } from "./pacing";
import type { Rect, TreeFilter, TreeOptions } from "./page-api";
import { captureScreenshot, viewportInfo } from "./screenshot";
import { clip, quote, truncateText } from "./text-utils";

const STOP_COOLDOWN_MS = 30_000;
const SNAPSHOT_TREE_CHARS = 5000;
// A research run that opens a tab per result is what trips a site's rate limit, so the ghost keeps only a few tabs.
const MAX_OWN_TABS = 8;
const MAX_OWN_TABS_PER_SITE = 3;
const stoppedUntil = new Map<number, number>();

export function markStopped(tabId: number): void {
  stoppedUntil.set(tabId, Date.now() + STOP_COOLDOWN_MS);
  void sessions.find(tabId)?.detach();
}

const RESTRICTED_URL = /^(chrome|chrome-extension|edge|about|devtools|view-source|chrome-untrusted):/;

const tabIdOf = (tab: chrome.tabs.Tab): number => {
  if (tab.id === undefined) throw new ArgError("Tab has no id");
  return tab.id;
};

/** Without a tabId the AI stays in Yurei's own window; only before that window exists does it fall back to the user's active tab. */
async function defaultTab(): Promise<chrome.tabs.Tab | undefined> {
  const own = await ownWindowId();
  if (own !== null) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: own });
    if (tab) return tab;
  }
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return focused ?? (await chrome.tabs.query({ active: true }))[0];
}

async function resolveTab(args: Args, allowRestricted = false): Promise<chrome.tabs.Tab> {
  const requested = optNumber(args, "tabId");
  const tab = requested === undefined ? await defaultTab() : await chrome.tabs.get(requested).catch(() => undefined);
  if (requested !== undefined && !tab) throw new ArgError(`No tab with id ${requested}. Call tabs_context to list open tabs.`);
  if (!tab) throw new ArgError("No open tab. Call tabs_create with a url first.");
  const tabId = tabIdOf(tab);
  if (!allowRestricted && RESTRICTED_URL.test(tab.url ?? "")) {
    throw new ArgError(`Tab ${tabId} shows a browser-internal page (${tab.url}) that cannot be controlled. Use navigate with a website url first.`);
  }
  const until = stoppedUntil.get(tabId);
  if (until !== undefined) {
    if (Date.now() < until) throw new ArgError("The user pressed Stop on this tab. Stop working on it until the user asks you to continue.");
    stoppedUntil.delete(tabId);
  }
  // Screenshots need a visible tab, and the user should see what the AI is doing.
  if (!tab.active) {
    await chrome.tabs.update(tabId, { active: true });
    await pause(150);
  }
  return tab;
}

type Outline = { readonly text: string; readonly viewport: string; readonly consent: string | null };

/** Outline of the whole tab: top frame plus every reachable iframe, composed into one indented text. Cookie banners get dismissed on the way. */
async function outline(tabId: number, filter: TreeFilter, maxChars: number, viewportOnly: boolean): Promise<Outline> {
  const options = (clip: Rect | null, dismissConsent: boolean): TreeOptions => ({ filter, ref: null, selector: null, maxChars, viewportOnly, clip, dismissConsent });
  let walk = await walkFrames(tabId, "tree", (clip) => [options(clip, true)]);
  const consent = walk.results.map((r) => (r.data ? fieldString(r.data, "consent") : "")).find((c) => c.length > 0) ?? null;
  if (consent !== null) {
    // The outline just taken still shows the banner; give the page a moment to drop it and look again.
    await pause(600);
    walk = await walkFrames(tabId, "tree", (clip) => [options(clip, false)]);
  }
  const vp = viewportOf(walk.results.find((r) => r.frameId === 0)?.data ?? {});
  return { text: truncateText(composeTree(walk, filter), maxChars, "use read_page with a ref or selector to focus"), viewport: `${vp.width}x${vp.height}`, consent };
}

const consentNote = (label: string): string => `Note: dismissed a cookie banner by clicking ${quote(label)}.`;

const wantsScreenshot = (args: Args): boolean => optBoolean(args, "screenshot") === true;

async function snapshot(tabId: number, session: TabSession, headline: string, withImage: boolean): Promise<ToolResult> {
  const tree = await outline(tabId, "interactive", SNAPSHOT_TREE_CHARS, true);
  const tab = await chrome.tabs.get(tabId);
  const notes = session.takeNotes().map((n) => `Note: ${n}`);
  if (tree.consent !== null) notes.push(consentNote(tree.consent));
  const header = [headline, `Tab ${tabId}: ${tab.title ?? ""}`, `URL: ${tab.url ?? ""}`, ...notes].filter((l) => l.length > 0).join("\n");
  const elements = tree.text || "(none visible; scroll or use read_page filter=all)";
  const elementsBlock = `Interactive elements in view (use their [ref] with computer or form_input):\n${elements}`;

  if (!withImage) return textResult(`${header}\nViewport ${tree.viewport} CSS px.\n${elementsBlock}`);

  await hideForCapture(tabId);
  try {
    const shot = await captureScreenshot(session);
    return {
      isError: false,
      content: [
        { type: "text", text: `${header}\nScreenshot ${shot.width}x${shot.height}px; coordinates for computer actions are in these pixels.\n${elementsBlock}` },
        { type: "image", mimeType: "image/jpeg", data: shot.data },
      ],
    };
  } finally {
    await showAfterCapture(tabId);
  }
}

async function waitForLoad(tabId: number, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  await sleep(150);
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab) throw new Error("The tab was closed during navigation");
    if (tab.status === "complete") {
      await sleep(250);
      return;
    }
    await sleep(150);
  }
}

const FULL_URL = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:about|data|javascript|mailto|blob|view-source):)/i;
const HOST_URL = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})(?::\d{1,5})?(?:[/?#]|$)/i;
const LOCAL_HOST = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Full URLs pass through; hosts get a scheme (http for localhost and IP literals); anything else becomes a search. */
function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (FULL_URL.test(trimmed)) return trimmed;
  const host = HOST_URL.exec(trimmed)?.[1];
  if (host) return `${LOCAL_HOST.test(host) ? "http" : "https"}://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

type Target = { readonly x: number; readonly y: number; readonly label: string };

/** A CSS-pixel point expressed in the last screenshot's pixels, the unit coordinates are given in. */
const imagePoint = (session: TabSession, { x, y }: Target): string => `(${Math.round(x * session.imageScale)}, ${Math.round(y * session.imageScale)})`;

type ScrollMetrics = { readonly top: number; readonly height: number; readonly view: number };

/** Scroll position of whatever scrolls under the pointer: an inner list if there is one, else the document. */
async function scrollMetrics(session: TabSession, { x, y }: Point): Promise<ScrollMetrics> {
  const v = await session.evaluate(`(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    let el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
    for (; el && el !== doc && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) break;
    }
    const s = el && el !== doc && el !== document.body ? el : doc;
    return { top: s.scrollTop, height: s.scrollHeight, view: s.clientHeight };
  })()`);
  if (!isRecord(v) || typeof v["top"] !== "number" || typeof v["height"] !== "number" || typeof v["view"] !== "number") throw new Error("Could not read the scroll position");
  return { top: v["top"], height: v["height"], view: v["view"] };
}

async function toCss(session: TabSession, [x, y]: Coordinate): Promise<Target> {
  const cssX = x / session.imageScale;
  const cssY = y / session.imageScale;
  const vp = await viewportInfo(session);
  if (cssX < 0 || cssY < 0 || cssX > vp.width || cssY > vp.height) {
    throw new ArgError(`Coordinate [${x}, ${y}] is outside the ${Math.round(vp.width * session.imageScale)}x${Math.round(vp.height * session.imageScale)} screenshot. Take a new screenshot first.`);
  }
  return { x: cssX, y: cssY, label: "" };
}

/** Position of a ref in top-frame viewport coordinates, whichever frame it lives in. */
async function refTarget(session: TabSession, tabId: number, ref: string, method: "rect" | "scrollTo"): Promise<Target> {
  const frameId = frameOfRef(ref);
  const chain = await frameChain(tabId, frameId);
  await chainOffset(tabId, chain);
  const r = await callPage(tabId, frameId, method, [localRef(ref)]);
  const label = `${fieldString(r, "label")} [${ref}]`;
  if (frameId === 0) return { x: fieldNumber(r, "x"), y: fieldNumber(r, "y"), label };
  // scrollIntoView inside the frame may have scrolled its ancestors as well, so measure the iframes afterwards.
  const offset = await chainOffset(tabId, chain);
  const vp = await viewportInfo(session);
  const clamp = (v: number, max: number): number => Math.min(Math.max(v, 1), max - 1);
  return { x: clamp(offset.x + fieldNumber(r, "x"), vp.width), y: clamp(offset.y + fieldNumber(r, "y"), vp.height), label };
}

async function resolveTarget(args: Args, session: TabSession, tabId: number): Promise<Target> {
  const ref = optString(args, "ref");
  if (ref) return refTarget(session, tabId, ref, "rect");
  const coordinate = optCoordinate(args, "coordinate");
  if (coordinate) return toCss(session, coordinate);
  throw new ArgError('Provide "ref" (from read_page/find) or "coordinate": [x, y].');
}

function modifiersFrom(args: Args): number {
  const raw = optString(args, "modifiers");
  if (!raw) return 0;
  return parseKeyPress(`${raw}+a`).modifiers;
}

const BUTTON_MASK = { left: 1, right: 2, middle: 4 } as const;
type Button = keyof typeof BUTTON_MASK;

async function mouse(session: TabSession, type: string, x: number, y: number, extra: Record<string, unknown> = {}): Promise<void> {
  await session.send("Input.dispatchMouseEvent", { type, x: Math.round(x), y: Math.round(y), ...extra });
}

/** Walks the pointer to the target so the page sees a trail of mousemoves instead of one jump. */
async function moveTo(session: TabSession, tabId: number, to: Point, buttons: number, modifiers = 0): Promise<void> {
  const path = movePath(session.cursor, to);
  const extra = { button: buttons === 0 ? "none" : "left", buttons, modifiers };
  await moveCursor(tabId, to.x, to.y);
  for (const step of path.slice(0, -1)) {
    await mouse(session, "mouseMoved", step.x, step.y, extra);
    await pause(14);
  }
  await mouse(session, "mouseMoved", to.x, to.y, extra);
  session.cursor = { x: to.x, y: to.y };
}

async function click(session: TabSession, tabId: number, target: Target, button: Button, count: number, modifiers: number): Promise<void> {
  await moveTo(session, tabId, target, 0, modifiers);
  await pause(60);
  for (let i = 1; i <= count; i++) {
    await mouse(session, "mousePressed", target.x, target.y, { button, buttons: BUTTON_MASK[button], clickCount: i, modifiers });
    await pause(20);
    await mouse(session, "mouseReleased", target.x, target.y, { button, buttons: 0, clickCount: i, modifiers });
    if (i < count) await pause(80);
  }
}

async function pressKey(session: TabSession, combo: string): Promise<void> {
  const { def, modifiers, commands } = parseKeyPress(combo);
  const printable = def.text !== undefined && (modifiers & (MOD.ctrl | MOD.meta | MOD.alt)) === 0;
  const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode, modifiers };
  await session.send("Input.dispatchKeyEvent", {
    ...base,
    type: printable ? "keyDown" : "rawKeyDown",
    ...(printable && { text: def.text, unmodifiedText: def.text }),
    ...(commands.length > 0 && { commands }),
  });
  await pause(35);
  await session.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

async function typeText(session: TabSession, text: string): Promise<void> {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line) await session.send("Input.insertText", { text: line });
    if (i < lines.length - 1) await pressKey(session, "Enter");
  }
}

async function computer(args: Args): Promise<ToolResult> {
  const tab = await resolveTab(args);
  const tabId = tabIdOf(tab);
  const session = sessions.get(tabId);
  await session.ensureAttached();
  const action = reqEnum(args, "action", COMPUTER_ACTIONS);
  if (action !== "screenshot" && action !== "wait") await takeTurn(tab.url ?? "", "action");
  const view = (headline: string): Promise<ToolResult> => snapshot(tabId, session, headline, action === "screenshot" || wantsScreenshot(args));

  switch (action) {
    case "screenshot":
      return view("");

    case "left_click":
    case "right_click":
    case "middle_click":
    case "double_click":
    case "triple_click": {
      const target = await resolveTarget(args, session, tabId);
      const button: Button = action === "right_click" ? "right" : action === "middle_click" ? "middle" : "left";
      const count = action === "double_click" ? 2 : action === "triple_click" ? 3 : 1;
      await click(session, tabId, target, button, count, modifiersFrom(args));
      await pause(400);
      return view(`${action} at ${imagePoint(session, target)}${target.label ? ` on ${target.label}` : ""}.`);
    }

    case "hover": {
      const target = await resolveTarget(args, session, tabId);
      await moveTo(session, tabId, target, 0);
      await pause(300);
      return view(`Hovering ${imagePoint(session, target)}${target.label ? ` on ${target.label}` : ""}.`);
    }

    case "type": {
      const text = reqString(args, "text");
      if (optString(args, "ref") || optCoordinate(args, "coordinate")) {
        const target = await resolveTarget(args, session, tabId);
        await click(session, tabId, target, "left", 1, 0);
        await pause(120);
      } else {
        await markActive(tabId);
      }
      await typeText(session, text);
      await pause(300);
      return view(`Typed ${JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text)}.`);
    }

    case "key": {
      const combo = optString(args, "text");
      if (!combo) throw new ArgError('key needs "text", e.g. "Enter", "cmd+a", "ctrl+shift+t", or a sequence "Tab Tab Enter".');
      await markActive(tabId);
      for (const part of combo.trim().split(/\s+/)) {
        await pressKey(session, part);
        await pause(45);
      }
      await pause(300);
      return view(`Pressed ${combo}.`);
    }

    case "scroll": {
      const direction = optEnum(args, "scroll_direction", ["up", "down", "left", "right"]) ?? "down";
      const ticks = optNumber(args, "scroll_amount") ?? 3;
      const px = Math.max(1, ticks) * 100;
      const vp = await viewportInfo(session);
      const target = optString(args, "ref") || optCoordinate(args, "coordinate")
        ? await resolveTarget(args, session, tabId)
        : { x: vp.width / 2, y: vp.height / 2, label: "" };
      const [deltaX, deltaY] = direction === "down" ? [0, px] : direction === "up" ? [0, -px] : direction === "right" ? [px, 0] : [-px, 0];
      await moveTo(session, tabId, target, 0);
      await mouse(session, "mouseWheel", target.x, target.y, { deltaX, deltaY });
      await pause(400);
      return view(`Scrolled ${direction} by ${px}px.`);
    }

    case "scroll_to_bottom": {
      const screens = Math.min(Math.max(Math.round(optNumber(args, "scroll_amount") ?? 10), 1), 30);
      const vp = await viewportInfo(session);
      const target = optString(args, "ref") || optCoordinate(args, "coordinate")
        ? await resolveTarget(args, session, tabId)
        : { x: vp.width / 2, y: vp.height / 2, label: "" };
      await moveTo(session, tabId, target, 0);
      const start = await scrollMetrics(session, target);
      let metrics = start;
      let done = 0;
      let atEnd = false;
      while (done < screens) {
        await mouse(session, "mouseWheel", target.x, target.y, { deltaX: 0, deltaY: Math.round(metrics.view * 0.9) });
        done++;
        await pause(350);
        metrics = await scrollMetrics(session, target);
        if (metrics.top + metrics.view < metrics.height - 2) continue;
        // At the end: lazy lists load their next batch about now, so wait before calling the page finished.
        await pause(900);
        const after = await scrollMetrics(session, target);
        if (after.height <= metrics.height) {
          atEnd = true;
          break;
        }
        metrics = after;
      }
      const grew = metrics.height - start.height;
      const growth = grew > 0 ? `; the page grew by ${grew}px as content loaded` : "";
      return view(`Scrolled through ${done} screen${done === 1 ? "" : "s"}${growth}. ${atEnd ? "Reached the end of the page." : "More may load: call scroll_to_bottom again to continue."}`);
    }

    case "scroll_to": {
      const target = await refTarget(session, tabId, reqString(args, "ref"), "scrollTo");
      await moveTo(session, tabId, target, 0);
      await pause(300);
      return view(`Scrolled ${target.label} into view.`);
    }

    case "left_click_drag": {
      const from = optCoordinate(args, "start_coordinate");
      const to = optCoordinate(args, "coordinate");
      if (!from || !to) throw new ArgError("left_click_drag needs start_coordinate and coordinate.");
      const a = await toCss(session, from);
      const b = await toCss(session, to);
      await moveTo(session, tabId, a, 0);
      await mouse(session, "mousePressed", a.x, a.y, { button: "left", buttons: 1, clickCount: 1 });
      await pause(60);
      await moveTo(session, tabId, b, 1);
      await mouse(session, "mouseReleased", b.x, b.y, { button: "left", buttons: 0, clickCount: 1 });
      await pause(400);
      return view(`Dragged from (${from[0]}, ${from[1]}) to (${to[0]}, ${to[1]}).`);
    }

    case "wait": {
      const seconds = Math.min(Math.max(optNumber(args, "duration") ?? 1, 0), 10);
      await sleep(seconds * 1000);
      return view(`Waited ${seconds}s.`);
    }
  }
}

async function tabsContext(): Promise<ToolResult> {
  const [tabs, windows, own] = await Promise.all([chrome.tabs.query({}), chrome.windows.getAll(), ownWindowId()]);
  const focusedWindow = windows.find((w) => w.focused)?.id;
  const where = (t: chrome.tabs.Tab): string => (t.windowId === own ? "Yurei's window" : t.windowId === focusedWindow ? "user's window, focused" : "user's window");
  const lines = tabs
    .filter((t) => t.id !== undefined)
    .sort((a, b) => Number(b.windowId === own) - Number(a.windowId === own))
    .map((t) => `${t.active ? "*" : " "} [${t.id}] ${t.title || "(untitled)"} — ${t.url ?? ""} (${where(t)})`);
  const ownership = own === null
    ? "Yurei has no window of its own yet: tabs_create or navigate with a url opens one."
    : "Tools without tabId use the active tab of Yurei's window.";
  return textResult(`${tabs.length} open tab(s); * marks the active tab of each window. ${ownership} Pass tabId to work in one of the user's tabs.\n${lines.join("\n")}`);
}

const describeTabs = (tabs: ReadonlyArray<chrome.tabs.Tab>): string => tabs.map((t) => `[${t.id}] ${clip(t.title || t.pendingUrl || t.url || "", 60)}`).join(", ");

async function checkTabBudget(destination: string): Promise<void> {
  const tabs = await ownTabs();
  if (tabs.length >= MAX_OWN_TABS) {
    throw new ArgError(`Yurei already has ${tabs.length} tabs open: ${describeTabs(tabs)}. Navigate in one of them, or close some with tabs_close, instead of opening more.`);
  }
  const site = siteOf(destination);
  const sameSite = site ? tabs.filter((t) => siteOf(t.pendingUrl ?? t.url ?? "") === site) : [];
  if (sameSite.length >= MAX_OWN_TABS_PER_SITE) {
    throw new ArgError(
      `Yurei already has ${sameSite.length} tabs open on ${site}: ${describeTabs(sameSite)}. Work in one of them (navigate with its tabId) or close one with tabs_close first: many tabs on one site at once get the user rate-limited or banned.`,
    );
  }
}

async function tabsCreate(args: Args): Promise<ToolResult> {
  const url = optString(args, "url");
  const destination = url ? normalizeUrl(url) : "about:blank";
  await checkTabBudget(destination);
  if (url) await takeTurn(destination, "load");
  const own = await ownWindowId();
  const tab = own === null ? await createOwnWindow(destination) : await chrome.tabs.create({ windowId: own, url: destination, active: true });
  const tabId = tabIdOf(tab);
  const where = own === null ? " in Yurei's new window" : "";
  if (!url) return textResult(`Created empty tab ${tabId}${where}. Use navigate with tabId ${tabId} and a url.`);
  await waitForLoad(tabId);
  const session = sessions.get(tabId);
  await session.ensureAttached();
  return snapshot(tabId, session, `Opened ${url} in tab ${tabId}${where}.`, wantsScreenshot(args));
}

async function tabsClose(args: Args): Promise<ToolResult> {
  const tabId = reqNumber(args, "tabId");
  await chrome.tabs.remove(tabId);
  sessions.remove(tabId);
  return textResult(`Closed tab ${tabId}.`);
}

async function navigate(args: Args): Promise<ToolResult> {
  const url = optString(args, "url");
  const action = optEnum(args, "action", ["back", "forward", "reload"]);
  if (!url && !action) throw new ArgError('navigate needs "url" or "action" (back | forward | reload).');
  // A url with no tab named goes to Yurei's window rather than taking over whatever the user is reading.
  if (url && optNumber(args, "tabId") === undefined && (await ownWindowId()) === null) return tabsCreate(args);
  const tab = await resolveTab(args, true);
  const tabId = tabIdOf(tab);
  const destination = url ? normalizeUrl(url) : (tab.url ?? "");
  await takeTurn(destination, "load");
  const session = sessions.get(tabId);
  session.console.splice(0);
  session.network.splice(0);
  // Attach before navigating so the page load's console and network events are captured; browser-internal pages refuse the debugger.
  if (!RESTRICTED_URL.test(tab.url ?? "")) await session.ensureAttached();
  if (url) await chrome.tabs.update(tabId, { url: destination });
  else if (action === "back") await chrome.tabs.goBack(tabId);
  else if (action === "forward") await chrome.tabs.goForward(tabId);
  else await chrome.tabs.reload(tabId);
  await waitForLoad(tabId);
  await session.ensureAttached();
  return snapshot(tabId, session, url ? `Navigated to ${url}.` : `Went ${action}.`, wantsScreenshot(args));
}

async function readPage(args: Args): Promise<ToolResult> {
  const tab = await resolveTab(args);
  const tabId = tabIdOf(tab);
  const filter = optEnum(args, "filter", ["interactive", "all"]) ?? "interactive";
  const ref = optString(args, "ref") ?? null;
  const selector = optString(args, "selector") ?? null;
  const maxChars = optNumber(args, "max_chars") ?? 30_000;
  const focused = ref !== null || selector !== null;
  const viewportOnly = filter === "interactive" && !focused;
  let text: string;
  let note = "";
  if (focused) {
    const frameId = ref === null ? 0 : frameOfRef(ref);
    const options: TreeOptions = { filter, ref: ref === null ? null : localRef(ref), selector, maxChars, viewportOnly, clip: null, dismissConsent: false };
    text = qualifyText(fieldString(await callPage(tabId, frameId, "tree", [options]), "text"), frameId);
  } else {
    const whole = await outline(tabId, filter, maxChars, viewportOnly);
    text = whole.text;
    if (whole.consent !== null) note = `${consentNote(whole.consent)}\n`;
  }
  const scope = ref ? `subtree of ${ref}` : selector ? `elements matching ${quote(selector)}` : viewportOnly ? "interactive elements in the viewport" : "all elements on the page (including off-screen)";
  return textResult(`Tab ${tabId}: ${tab.title ?? ""}\nURL: ${tab.url ?? ""}\n${note}${scope}:\n${text || "(nothing found)"}`);
}

async function find(args: Args): Promise<ToolResult> {
  const tab = await resolveTab(args);
  const query = reqString(args, "query");
  return textResult(composeFind(await walkFrames(tabIdOf(tab), "find", (clip) => [query, clip]), query));
}

async function getPageText(args: Args): Promise<ToolResult> {
  const tab = await resolveTab(args);
  const tabId = tabIdOf(tab);
  const maxChars = optNumber(args, "max_chars") ?? 20_000;
  const ref = optString(args, "ref") ?? null;
  const selector = optString(args, "selector") ?? null;
  const header = `Tab ${tabId}: ${tab.title ?? ""}\nURL: ${tab.url ?? ""}`;
  if (ref !== null) {
    const r = await callPage(tabId, frameOfRef(ref), "text", [maxChars, { ref: localRef(ref), selector: null }]);
    return textResult(`${header}\nText of ${ref}:\n\n${fieldString(r, "text")}`);
  }
  const walk = await walkFrames(tabId, "text", () => [maxChars, { ref: null, selector }]);
  const top = walk.results.find((r) => r.frameId === 0)?.data;
  const scope = top ? fieldString(top, "scope") : "page";
  const hint = selector === null && scope !== "page" ? ` (${scope}; pass selector="body" for everything, or a selector or ref for one part)` : ` (${scope})`;
  return textResult(`${header}\nText${hint}:\n\n${composeText(walk, maxChars)}`);
}

async function formInput(args: Args): Promise<ToolResult> {
  const tab = await resolveTab(args);
  const tabId = tabIdOf(tab);
  const ref = reqString(args, "ref");
  const raw = args["value"];
  const value = typeof raw === "boolean" ? raw : (optString(args, "value") ?? "");
  await markActive(tabId);
  const r = await callPage(tabId, frameOfRef(ref), "setValue", [localRef(ref), value]);
  return textResult(qualifyText(fieldString(r, "description"), frameOfRef(ref)));
}

async function javascriptTool(args: Args): Promise<ToolResult> {
  const tab = await resolveTab(args);
  await takeTurn(tab.url ?? "", "action");
  const session = sessions.get(tabIdOf(tab));
  const code = reqString(args, "code");
  // Statement lists with `return` or `await` only parse inside a function body; compiling first decides that without running the code.
  const compiled = await session.send("Runtime.compileScript", { expression: code, sourceURL: "", persistScript: false });
  const wrap = isRecord(compiled) && compiled["exceptionDetails"] !== undefined;
  const value = await session.evaluate(wrap ? `(async () => { ${code} })()` : code);
  const out = value === undefined ? "undefined" : typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return textResult(out.length > 20_000 ? `${out.slice(0, 20_000)}\n[truncated]` : out);
}

function compileFilter(pattern: string | undefined): (s: string) => boolean {
  if (!pattern) return () => true;
  try {
    const re = new RegExp(pattern, "i");
    return (s) => re.test(s);
  } catch {
    const needle = pattern.toLowerCase();
    return (s) => s.toLowerCase().includes(needle);
  }
}

const timeOf = (ts: number): string => new Date(ts).toISOString().slice(11, 23);

async function readConsole(args: Args): Promise<ToolResult> {
  const tab = await resolveTab(args);
  const session = sessions.get(tabIdOf(tab));
  await session.ensureAttached();
  const matches = compileFilter(optString(args, "pattern"));
  const limit = Math.max(1, optNumber(args, "limit") ?? 50);
  const entries = session.console.filter((e) => matches(`${e.level} ${e.text}`)).slice(-limit);
  if (optBoolean(args, "clear")) session.console.splice(0);
  if (entries.length === 0) {
    return textResult("No console messages captured. Yurei records console output from the moment it first touches a tab; reload the page with navigate(action=reload) to capture load-time messages.");
  }
  return textResult(entries.map((e) => `${timeOf(e.ts)} [${e.level}] ${e.text}`).join("\n"));
}

async function readNetwork(args: Args): Promise<ToolResult> {
  const tab = await resolveTab(args);
  const session = sessions.get(tabIdOf(tab));
  await session.ensureAttached();
  const matches = compileFilter(optString(args, "pattern"));
  const limit = Math.max(1, optNumber(args, "limit") ?? 50);
  const entries = session.network.filter((e) => matches(`${e.method} ${e.url} ${e.type}`)).slice(-limit);
  if (optBoolean(args, "clear")) session.network.splice(0);
  if (entries.length === 0) {
    return textResult("No network requests captured yet. Yurei records requests from the moment it first touches a tab; reload with navigate(action=reload) to capture the page load.");
  }
  const lines = entries.map((e) => `${timeOf(e.ts)} ${e.method} ${e.status ?? (e.failed ? `FAILED(${e.failed})` : "pending")} ${e.type} ${e.url}`);
  return textResult(lines.join("\n"));
}

async function resizeWindow(args: Args): Promise<ToolResult> {
  const tab = await resolveTab(args, true);
  const width = Math.round(reqNumber(args, "width"));
  const height = Math.round(reqNumber(args, "height"));
  if (tab.windowId === undefined) throw new ArgError("Tab has no window");
  const win = await chrome.windows.update(tab.windowId, { width, height, state: "normal" });
  await sleep(300);
  const outer = `Window resized to ${win.width ?? width}x${win.height ?? height}.`;
  // Browser-internal pages refuse the debugger, so the viewport cannot be measured there.
  if (RESTRICTED_URL.test(tab.url ?? "")) return textResult(outer);
  const vp = await viewportInfo(sessions.get(tabIdOf(tab)));
  return textResult(`${outer} Viewport is now ${vp.width}x${vp.height} CSS px.`);
}

export async function runTool(name: ToolName, args: Args): Promise<ToolResult> {
  try {
    switch (name) {
      case "tabs_context":
        return await tabsContext();
      case "tabs_create":
        return await tabsCreate(args);
      case "tabs_close":
        return await tabsClose(args);
      case "navigate":
        return await navigate(args);
      case "computer":
        return await computer(args);
      case "read_page":
        return await readPage(args);
      case "find":
        return await find(args);
      case "get_page_text":
        return await getPageText(args);
      case "form_input":
        return await formInput(args);
      case "javascript_tool":
        return await javascriptTool(args);
      case "read_console_messages":
        return await readConsole(args);
      case "read_network_requests":
        return await readNetwork(args);
      case "resize_window":
        return await resizeWindow(args);
    }
  } catch (e) {
    return errorResult(e instanceof ArgError ? e.message : `${name} failed: ${errorMessage(e)}`);
  }
}
