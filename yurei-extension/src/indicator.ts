import { DEFAULT_ACCENT, type IndicatorMessage } from "./messages";
import { sleep } from "./pacing";

const HIDE_AFTER_MS = 6000;
const CURSOR_SETTLE_MS = 250;
const hideTimers = new Map<number, ReturnType<typeof setTimeout>>();

export async function getAccent(): Promise<string> {
  const stored = await chrome.storage.sync.get("accent");
  const accent: unknown = stored["accent"];
  return typeof accent === "string" && /^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_ACCENT;
}

async function sendToTab(tabId: number, message: IndicatorMessage): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    // The content script is missing on tabs opened before install; inject it once and retry.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content/indicator.js"] });
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      return false;
    }
  }
}

function scheduleHide(tabId: number): void {
  const existing = hideTimers.get(tabId);
  if (existing) clearTimeout(existing);
  hideTimers.set(
    tabId,
    setTimeout(() => {
      hideTimers.delete(tabId);
      void sendToTab(tabId, { type: "yurei:hide" });
    }, HIDE_AFTER_MS),
  );
}

export async function markActive(tabId: number): Promise<void> {
  await sendToTab(tabId, { type: "yurei:show", color: await getAccent() });
  scheduleHide(tabId);
}

export async function moveCursor(tabId: number, x: number, y: number): Promise<void> {
  await markActive(tabId);
  await Promise.race([sendToTab(tabId, { type: "yurei:cursor", x, y }), sleep(CURSOR_SETTLE_MS)]);
}

export async function hideForCapture(tabId: number): Promise<void> {
  await sendToTab(tabId, { type: "yurei:hide-for-capture" });
}

export async function showAfterCapture(tabId: number): Promise<void> {
  await sendToTab(tabId, { type: "yurei:show-after-capture" });
}

export async function hideNow(tabId: number): Promise<void> {
  const existing = hideTimers.get(tabId);
  if (existing) clearTimeout(existing);
  hideTimers.delete(tabId);
  await sendToTab(tabId, { type: "yurei:hide" });
}
