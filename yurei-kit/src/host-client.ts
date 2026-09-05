import { randomUUID } from "node:crypto";
import { readdirSync, rmSync, statSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import {
  type Args,
  errorResult,
  PROTOCOL,
  parseHostToSession,
  type SessionToHost,
  type ToolName,
  type ToolResult,
} from "../../shared/protocol";
import { encodeFrame, FrameParser } from "./framing";
import { isHostSocketFile, isPrivateDir, socketAddress, socketDir } from "./paths";

export type HostClientOptions = {
  readonly harness: () => string;
  readonly log: (message: string) => void;
};

type Pending = { readonly resolve: (result: ToolResult) => void; readonly timer: NodeJS.Timeout };

export const NOT_CONNECTED_HELP = [
  "Yurei's Chrome extension is not connected.",
  "Fix: run `yurei setup` (it registers the native host and waits for the extension), make sure Yurei is enabled in",
  "chrome://extensions and its toolbar popup says Connected, then retry the tool call.",
].join("\n");

const HANDSHAKE_TIMEOUT_MS = 1500;
const CONNECT_GRACE_MS = 4000;
const DEFAULT_CALL_TIMEOUT_MS = 120_000;

type ExtensionState = { readonly connected: boolean; readonly version: string; readonly protocol: string };

const readdirOrEmpty = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** Null when the file vanished between readdir and stat: a host was cleaning up. */
const mtimeOrNull = (file: string): number | null => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/** Client side of the Unix socket (named pipe on Windows) to the native host, used by `yurei serve`, `doctor` and `call`. */
export class HostClient {
  private extension: ExtensionState = { connected: false, version: "", protocol: "" };
  private host = { version: "", latest: null as string | null };
  private socket: Socket | null = null;
  private connecting: Promise<boolean> | null = null;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly options: HostClientOptions) {}

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  get extensionConnected(): boolean {
    return this.extension.connected;
  }

  get extensionVersion(): string {
    return this.extension.version;
  }

  get extensionProtocol(): string {
    return this.extension.protocol;
  }

  /** Version of the native host process Chrome is running; "" before 0.3, which did not say. */
  get hostVersion(): string {
    return this.host.version;
  }

  /** Newest version on npm according to the host's daily check, if it found a newer one. */
  get latest(): string | null {
    return this.host.latest;
  }

  /** Newest host socket first: after an extension reload the old host is gone and its file may linger. */
  private candidateSockets(): string[] {
    const dir = socketDir();
    if (!isPrivateDir(dir)) return [];
    return readdirOrEmpty(dir)
      .filter(isHostSocketFile)
      .flatMap((name) => {
        const file = join(dir, name);
        const mtime = mtimeOrNull(file);
        return mtime === null ? [] : [{ file, mtime }];
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map((candidate) => candidate.file);
  }

  connect(): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    if (!this.connecting) this.connecting = this.connectImpl().finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async connectImpl(): Promise<boolean> {
    for (const path of this.candidateSockets()) {
      const socket = await this.handshake(path);
      if (socket) {
        this.socket = socket;
        return true;
      }
    }
    return false;
  }

  private handshake(path: string): Promise<Socket | null> {
    return new Promise((resolve) => {
      const socket = createConnection(socketAddress(path));
      const parser = new FrameParser();
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) {
          socket.destroy();
          resolve(null);
          return;
        }
        socket.removeAllListeners("data");
        socket.on("data", (chunk: Buffer) => this.onData(parser, chunk));
        socket.on("close", () => this.onClose());
        socket.on("error", (e) => this.options.log(`host socket error: ${e.message}`));
        resolve(socket);
      };
      const timer = setTimeout(() => finish(false), HANDSHAKE_TIMEOUT_MS);
      socket.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "ECONNREFUSED" || e.code === "ENOENT") rmSync(path, { force: true });
        finish(false);
      });
      socket.once("connect", () => {
        socket.write(encodeFrame(this.hello()));
      });
      socket.on("data", (chunk: Buffer) => {
        for (const raw of parser.push(chunk)) {
          const message = parseHostToSession(raw);
          if (message?.type !== "welcome") continue;
          this.extension = {
            connected: message.extensionConnected,
            version: message.extensionVersion,
            protocol: message.extensionProtocol,
          };
          this.host = { version: message.version, latest: message.latest };
          this.options.log(
            `connected to native host at ${path} (host v${message.version || "<0.3"}, extension ${message.extensionConnected ? `v${message.extensionVersion}` : "not ready"})`,
          );
          finish(true);
        }
      });
    });
  }

  private hello(): SessionToHost {
    return { type: "hello", protocol: PROTOCOL, harness: this.options.harness() };
  }

  /** Re-sends hello so the extension popup shows the real harness name once the MCP client has introduced itself. */
  announce(): void {
    this.send(this.hello());
  }

  private onData(parser: FrameParser, chunk: Buffer): void {
    for (const raw of parser.push(chunk)) {
      const message = parseHostToSession(raw);
      if (!message) continue;
      switch (message.type) {
        case "result": {
          const pending = this.pending.get(message.id);
          if (!pending) break;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          pending.resolve(message.result);
          break;
        }
        case "extension":
          this.extension = { connected: message.connected, version: message.version, protocol: message.protocol };
          break;
        case "latest":
          this.host = { ...this.host, latest: message.version };
          break;
        case "welcome":
          break;
      }
    }
  }

  private onClose(): void {
    this.socket = null;
    this.extension = { ...this.extension, connected: false };
    this.options.log("native host went away (extension reloaded or Chrome closed)");
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve(errorResult("The Yurei extension disconnected during the call. Retry."));
      this.pending.delete(id);
    }
  }

  private send(message: SessionToHost, flushed?: () => void): boolean {
    if (!this.socket || this.socket.destroyed) return false;
    this.socket.write(encodeFrame(message), flushed);
    return true;
  }

  /** Asks the extension to reload itself from disk (development). Resolves once the frame has left the socket. */
  reload(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.send({ type: "reload" }, () => resolve(true))) resolve(false);
    });
  }

  /** Asks the host to exit so that Chrome starts the installed version; hosts before 0.3 ignore it. */
  restartHost(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.send({ type: "restart" }, () => resolve(true))) resolve(false);
    });
  }

  async waitForExtension(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await this.connect()) && this.extensionConnected) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return this.connected && this.extensionConnected;
  }

  async call(tool: ToolName, args: Args, timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<ToolResult> {
    if (!(await this.waitForExtension(CONNECT_GRACE_MS))) return errorResult(NOT_CONNECTED_HELP);
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(
          errorResult(
            `${tool} timed out after ${timeoutMs / 1000}s. The page may be hung; try navigate(action=reload).`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      if (!this.send({ type: "call", id, tool, args })) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(errorResult(NOT_CONNECTED_HELP));
      }
    });
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}
