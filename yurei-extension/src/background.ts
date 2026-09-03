import { NativeBridge } from "./bridge";
import { sessions } from "./cdp";
import { getAccent, hideNow } from "./indicator";
import { isRuntimeMessage, type StatusResponse } from "./messages";
import { markStopped, runTool } from "./tools";

const RECONNECT_INTERVAL_MS = 5000;

const bridge = new NativeBridge(runTool);

bridge.connect();
setInterval(() => bridge.connect(), RECONNECT_INTERVAL_MS);
// Alarms wake the service worker after Chrome suspends it so the host gets reconnected.
void chrome.alarms.create("yurei-reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => bridge.connect());
chrome.runtime.onInstalled.addListener(() => bridge.connect());
chrome.runtime.onStartup.addListener(() => bridge.connect());

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRuntimeMessage(message)) return false;
  switch (message.type) {
    case "yurei:stop": {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        markStopped(tabId);
        void hideNow(tabId);
      }
      sendResponse({ ok: true });
      return false;
    }
    case "yurei:stop-all": {
      for (const tabId of sessions.tabIds()) {
        markStopped(tabId);
        void hideNow(tabId);
      }
      sendResponse({ ok: true });
      return false;
    }
    case "yurei:reconnect": {
      bridge.connect();
      sendResponse({ ok: true });
      return false;
    }
    case "yurei:status": {
      void getAccent().then((accent) => {
        const status: StatusResponse = { version: chrome.runtime.getManifest().version, accent, ...bridge.status() };
        sendResponse(status);
      });
      return true;
    }
    case "yurei:set-accent": {
      void chrome.storage.sync.set({ accent: message.color }).then(() => sendResponse({ ok: true }));
      return true;
    }
  }
});
