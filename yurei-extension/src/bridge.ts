import {
  NATIVE_HOST_NAME, PROTOCOL, errorResult, parseHostToExtension,
  type Args, type ExtensionToHost, type Session, type ToolName, type ToolResult,
} from "../../shared/protocol";
import { errorMessage } from "./cdp";

type Handler = (tool: ToolName, args: Args) => Promise<ToolResult>;

export type BridgeStatus = {
  readonly connected: boolean;
  readonly error: string | null;
  readonly sessions: ReadonlyArray<Session>;
};

/**
 * Talks to the `yurei native-host` process that Chrome spawns for us. Chrome frames the messages,
 * keeps the process alive while the port is open and kills it when we disconnect.
 */
export class NativeBridge {
  private port: chrome.runtime.Port | null = null;
  private sessions: ReadonlyArray<Session> = [];
  private error: string | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly handler: Handler) {}

  status(): BridgeStatus {
    return { connected: this.port !== null && this.error === null, error: this.error, sessions: this.sessions };
  }

  connect(): void {
    if (this.port) return;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (e) {
      this.error = errorMessage(e);
      return;
    }
    this.port = port;
    port.onMessage.addListener((raw: unknown) => this.onMessage(raw));
    port.onDisconnect.addListener(() => {
      this.error = chrome.runtime.lastError?.message ?? "Native host disconnected";
      this.port = null;
      this.sessions = [];
    });
    this.send({ type: "hello", protocol: PROTOCOL, extensionId: chrome.runtime.id, version: chrome.runtime.getManifest().version });
  }

  private onMessage(raw: unknown): void {
    const message = parseHostToExtension(raw);
    if (!message) return;
    switch (message.type) {
      case "welcome":
        this.error = null;
        this.sessions = message.sessions;
        return;
      case "sessions":
        this.sessions = message.sessions;
        return;
      case "ping":
        this.send({ type: "pong" });
        return;
      case "reload":
        // Store installs carry an update_url and have nothing new on disk; Chrome also disables extensions that reload too often.
        if (!chrome.runtime.getManifest().update_url) chrome.runtime.reload();
        return;
      case "call":
        // One tool at a time: two harness sessions must not fight over the debugger.
        this.queue = this.queue.then(async () => {
          const result = await this.handler(message.tool, message.args).catch((e: unknown) => errorResult(errorMessage(e)));
          this.send({ type: "result", id: message.id, result });
        });
        return;
    }
  }

  private send(message: ExtensionToHost): void {
    try {
      this.port?.postMessage(message);
    } catch (e) {
      this.error = errorMessage(e);
      this.port = null;
    }
  }
}
