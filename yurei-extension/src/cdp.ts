import { isRecord } from "../../shared/protocol";
import type { Point } from "./pacing";

type Params = Record<string, unknown>;

export type ConsoleEntry = { readonly ts: number; readonly level: string; readonly text: string };
export type NetworkEntry = {
  readonly ts: number;
  readonly method: string;
  readonly url: string;
  readonly type: string;
  status?: number;
  failed?: string;
};

const MAX_ENTRIES = 300;

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const pushCapped = <T>(list: T[], item: T): void => {
  list.push(item);
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
};

const describeRemoteObject = (v: unknown): string => {
  if (!isRecord(v)) return String(v);
  if ("value" in v) return typeof v["value"] === "string" ? v["value"] : JSON.stringify(v["value"]);
  return typeof v["description"] === "string" ? v["description"] : String(v["type"]);
};

export class TabSession {
  readonly console: ConsoleEntry[] = [];
  readonly network: NetworkEntry[] = [];
  /** Ratio between the last screenshot's pixel width and the viewport's CSS width. */
  imageScale = 1;
  /** Where the pointer was left, so the next move can start its path from there. */
  cursor: Point | null = null;
  private readonly inflight = new Map<string, NetworkEntry>();
  private notes: string[] = [];
  private attached = false;
  private attaching: Promise<void> | null = null;

  constructor(readonly tabId: number) {}

  async ensureAttached(): Promise<void> {
    if (this.attached) return;
    if (!this.attaching) this.attaching = this.attach().finally(() => (this.attaching = null));
    return this.attaching;
  }

  private async attach(): Promise<void> {
    try {
      await chrome.debugger.attach({ tabId: this.tabId }, "1.3");
    } catch (e) {
      const msg = errorMessage(e);
      if (!msg.includes("already attached")) throw new Error(`Cannot attach to tab ${this.tabId}: ${msg}`);
      // Either we are still attached from before a service-worker restart, or DevTools is open.
      try {
        await chrome.debugger.sendCommand({ tabId: this.tabId }, "Runtime.evaluate", { expression: "1" });
      } catch {
        throw new Error(`Tab ${this.tabId} is being debugged by something else. Close Chrome DevTools on that tab and retry.`);
      }
    }
    this.attached = true;
    await Promise.all([this.raw("Runtime.enable"), this.raw("Page.enable"), this.raw("Network.enable")]);
  }

  private async raw(method: string, params?: Params): Promise<unknown> {
    try {
      return await chrome.debugger.sendCommand({ tabId: this.tabId }, method, params);
    } catch (e) {
      const msg = errorMessage(e);
      if (/detached|not attached|No tab with given id/i.test(msg)) this.attached = false;
      throw new Error(`${method} failed: ${msg}`);
    }
  }

  async send(method: string, params?: Params): Promise<unknown> {
    await this.ensureAttached();
    return this.raw(method, params);
  }

  async evaluate(expression: string): Promise<unknown> {
    const res = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (!isRecord(res)) throw new Error("Runtime.evaluate returned nothing");
    const details = res["exceptionDetails"];
    if (isRecord(details)) {
      const exception = details["exception"];
      const text = isRecord(exception) && typeof exception["description"] === "string"
        ? exception["description"]
        : String(details["text"]);
      throw new Error(text);
    }
    const result = res["result"];
    return isRecord(result) ? result["value"] : undefined;
  }

  onDetached(): void {
    this.attached = false;
    this.cursor = null;
  }

  async detach(): Promise<void> {
    if (!this.attached) return;
    this.attached = false;
    try {
      await chrome.debugger.detach({ tabId: this.tabId });
    } catch {
      // Tab may already be gone.
    }
  }

  addNote(note: string): void {
    this.notes.push(note);
  }

  takeNotes(): ReadonlyArray<string> {
    const out = this.notes;
    this.notes = [];
    return out;
  }

  handleEvent(method: string, params: unknown): void {
    if (!isRecord(params)) return;
    switch (method) {
      case "Runtime.consoleAPICalled": {
        const args = Array.isArray(params["args"]) ? params["args"] : [];
        pushCapped(this.console, {
          ts: Date.now(),
          level: String(params["type"] ?? "log"),
          text: args.map(describeRemoteObject).join(" "),
        });
        return;
      }
      case "Runtime.exceptionThrown": {
        const details = params["exceptionDetails"];
        const exception = isRecord(details) ? details["exception"] : undefined;
        const text = isRecord(exception) && typeof exception["description"] === "string"
          ? exception["description"]
          : isRecord(details) ? String(details["text"]) : "Uncaught exception";
        pushCapped(this.console, { ts: Date.now(), level: "error", text });
        return;
      }
      case "Network.requestWillBeSent": {
        const request = params["request"];
        if (!isRecord(request)) return;
        const entry: NetworkEntry = {
          ts: Date.now(),
          method: String(request["method"] ?? "GET"),
          url: String(request["url"] ?? ""),
          type: String(params["type"] ?? "Other"),
        };
        this.inflight.set(String(params["requestId"]), entry);
        pushCapped(this.network, entry);
        return;
      }
      case "Network.responseReceived": {
        const entry = this.inflight.get(String(params["requestId"]));
        const response = params["response"];
        if (entry && isRecord(response) && typeof response["status"] === "number") entry.status = response["status"];
        this.inflight.delete(String(params["requestId"]));
        return;
      }
      case "Network.loadingFailed": {
        const entry = this.inflight.get(String(params["requestId"]));
        if (entry) entry.failed = String(params["errorText"] ?? "failed");
        this.inflight.delete(String(params["requestId"]));
        return;
      }
      case "Page.javascriptDialogOpening": {
        const kind = String(params["type"] ?? "dialog");
        const message = String(params["message"] ?? "");
        this.addNote(`A ${kind} dialog said "${message}" and was auto-accepted.`);
        pushCapped(this.console, { ts: Date.now(), level: "dialog", text: `[${kind}] ${message}` });
        void this.raw("Page.handleJavaScriptDialog", { accept: true }).catch(() => undefined);
        return;
      }
      default:
        return;
    }
  }
}

class Sessions {
  private readonly map = new Map<number, TabSession>();

  get(tabId: number): TabSession {
    const existing = this.map.get(tabId);
    if (existing) return existing;
    const created = new TabSession(tabId);
    this.map.set(tabId, created);
    return created;
  }

  find(tabId: number): TabSession | undefined {
    return this.map.get(tabId);
  }

  tabIds(): ReadonlyArray<number> {
    return [...this.map.keys()];
  }

  remove(tabId: number): void {
    this.map.get(tabId)?.onDetached();
    this.map.delete(tabId);
  }
}

export const sessions = new Sessions();

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId === undefined) return;
  sessions.find(source.tabId)?.handleEvent(method, params);
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) sessions.find(source.tabId)?.onDetached();
});

chrome.tabs.onRemoved.addListener((tabId) => sessions.remove(tabId));
