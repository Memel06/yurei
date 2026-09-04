import { isRecord } from "../../shared/protocol";

const ID_KEY = "ownWindowId";
const BOUNDS_KEY = "ownWindowBounds";

type Bounds = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

const isBounds = (v: unknown): v is Bounds =>
  isRecord(v) && ["left", "top", "width", "height"].every((k) => typeof v[k] === "number");

let cached: number | null | undefined;

async function storedId(): Promise<number | null> {
  if (cached !== undefined) return cached;
  const stored = await chrome.storage.session.get(ID_KEY);
  const id: unknown = stored[ID_KEY];
  cached = typeof id === "number" ? id : null;
  return cached;
}

async function forget(): Promise<void> {
  cached = null;
  await chrome.storage.session.remove(ID_KEY);
}

/** Yurei's own window, while it is open. Tabs the AI opens go there so the user's windows stay theirs. */
export async function ownWindowId(): Promise<number | null> {
  const id = await storedId();
  if (id === null) return null;
  if (await chrome.windows.get(id).catch(() => undefined)) return id;
  await forget();
  return null;
}

export async function ownTabs(): Promise<ReadonlyArray<chrome.tabs.Tab>> {
  const id = await ownWindowId();
  return id === null ? [] : chrome.tabs.query({ windowId: id });
}

/**
 * Opens Yurei's window where the user last left it. The very first one comes to the front so they see where the
 * ghost lives; after that it never takes focus, so it can sit on the side or behind while they keep working.
 */
export async function createOwnWindow(url: string): Promise<chrome.tabs.Tab> {
  const stored = await chrome.storage.local.get(BOUNDS_KEY);
  const bounds: unknown = stored[BOUNDS_KEY];
  const placed = isBounds(bounds);
  const win = await chrome.windows.create({ url, type: "normal", focused: !placed, ...(placed ? bounds : {}) });
  if (win?.id === undefined) throw new Error("Chrome did not open a window");
  cached = win.id;
  await chrome.storage.session.set({ [ID_KEY]: win.id });
  const tab = win.tabs?.[0] ?? (await chrome.tabs.query({ windowId: win.id }))[0];
  if (!tab) throw new Error("The new window has no tab");
  return tab;
}

chrome.windows.onRemoved.addListener((id) => {
  void storedId().then((own) => (own === id ? forget() : undefined));
});

chrome.windows.onBoundsChanged.addListener((win) => {
  void storedId().then((own) => {
    // Maximised or full-screen bounds would come back as a window that hides the user's; the event may omit state entirely.
    if (own !== win.id || (win.state !== undefined && win.state !== "normal")) return;
    const { left, top, width, height } = win;
    if (left === undefined || top === undefined || width === undefined || height === undefined) return;
    void chrome.storage.local.set({ [BOUNDS_KEY]: { left, top, width, height } });
  });
});
