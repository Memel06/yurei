import { appendFileSync, chmodSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { join } from "node:path";
import {
  PROTOCOL, UPDATE_COMMAND, errorResult, parseExtensionToHost, parseSessionToHost,
  type HostToExtension, type HostToSession, type Session, type ToolName, type ToolResult,
} from "../../shared/protocol";
import { isNewer } from "../../shared/semver";
import { FrameParser, encodeFrame } from "./framing";
import { ensureDir, hostLogPath, hostSocketFile, isHostSocketFile, isPrivateDir, isWindows, socketAddress, socketDir, yureiHome } from "./paths";
import { latestVersion } from "./update";
import { VERSION } from "./version";

const PING_INTERVAL_MS = 20_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Chrome disconnects a native host that sends one message above 1 MB, so oversize calls are refused before they reach it. */
const MAX_MESSAGE_BYTES = 1024 * 1024;

const tooLarge = (tool: ToolName, bytes: number): ToolResult =>
  errorResult(
    `${tool} was not sent: the call is ${(bytes / MAX_MESSAGE_BYTES).toFixed(1)} MB of JSON and Chrome accepts at most 1 MB per message from a native host. Pass less data in one call.`,
  );

type SessionConn = { readonly socket: Socket; readonly parser: FrameParser; harness: string };

const log = (message: string): void => {
  try {
    ensureDir(yureiHome());
    appendFileSync(hostLogPath(), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never break the host.
  }
};

const removeStaleSockets = (dir: string, keep: string): void => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (!isHostSocketFile(name) || file === keep) continue;
    const probe = createConnection(socketAddress(file));
    probe.once("connect", () => probe.destroy());
    probe.once("error", () => rmSync(file, { force: true }));
  }
};

/**
 * Process spawned by Chrome through native messaging. stdin/stdout speak to the extension; a Unix socket (a named
 * pipe on Windows) accepts any number of `yurei serve` sessions and multiplexes their tool calls onto the single extension.
 */
export function runNativeHost(): void {
  const dir = ensureDir(socketDir());
  if (!isPrivateDir(dir)) {
    const problem = `${dir} is not a private directory owned by you (mode 0700, not a symlink). Remove it, then reload the extension.`;
    log(problem);
    throw new Error(problem);
  }
  const socketPath = hostSocketFile(process.pid);
  removeStaleSockets(dir, socketPath);
  // A host with this pid that died without cleaning up would otherwise make listen fail with EADDRINUSE.
  rmSync(socketPath, { force: true });

  const sessions = new Map<number, SessionConn>();
  let nextSessionId = 1;
  let extensionVersion = "";
  let extensionProtocol = "";
  /** Said hello and speaks our protocol. */
  let extensionReady = false;
  let latest: string | null = null;

  const toExtension = (message: HostToExtension): void => {
    process.stdout.write(encodeFrame(message));
  };
  const toSession = (conn: SessionConn, message: HostToSession): void => {
    if (!conn.socket.destroyed) conn.socket.write(encodeFrame(message));
  };
  const sessionList = (): ReadonlyArray<Session> => [...sessions.values()].map((s) => ({ harness: s.harness }));
  const broadcastSessions = (): void => {
    if (extensionReady) toExtension({ type: "sessions", sessions: sessionList() });
  };
  const welcomeSession = (): HostToSession => ({
    type: "welcome", protocol: PROTOCOL, version: VERSION, extensionConnected: extensionReady, extensionVersion, extensionProtocol, latest,
  });

  const checkForUpdates = async (): Promise<void> => {
    const found = await latestVersion();
    if (found === null || !isNewer(found, VERSION) || found === latest) return;
    latest = found;
    log(`v${found} is on npm`);
    toExtension({ type: "latest", version: found });
    for (const conn of sessions.values()) toSession(conn, { type: "latest", version: found });
  };

  const parser = new FrameParser();
  process.stdin.on("data", (chunk: Buffer) => {
    for (const raw of parser.push(chunk)) {
      const message = parseExtensionToHost(raw);
      if (!message) continue;
      switch (message.type) {
        case "hello":
          extensionVersion = message.version;
          extensionProtocol = message.protocol;
          extensionReady = message.protocol === PROTOCOL;
          log(`extension ${message.extensionId} v${message.version} connected${extensionReady ? "" : ` speaking ${message.protocol}, this host speaks ${PROTOCOL}`}`);
          // Sent even on a mismatch: the extension needs our version to tell the user which half to update.
          toExtension({ type: "welcome", protocol: PROTOCOL, version: VERSION, sessions: sessionList() });
          if (latest !== null) toExtension({ type: "latest", version: latest });
          for (const conn of sessions.values()) toSession(conn, { type: "extension", connected: extensionReady, version: extensionVersion, protocol: extensionProtocol });
          break;
        case "result": {
          const separator = message.id.indexOf(":");
          const conn = sessions.get(Number(message.id.slice(0, separator)));
          if (conn) toSession(conn, { type: "result", id: message.id.slice(separator + 1), result: message.result });
          break;
        }
        case "pong":
          break;
      }
    }
  });

  const notConnected = (): ToolResult =>
    extensionVersion === ""
      ? errorResult("The Yurei extension has not finished connecting to its native host yet. Retry in a moment; if it persists, reload the extension in chrome://extensions.")
      : errorResult(
          `The Yurei extension (v${extensionVersion}) and the command line tool (v${VERSION}) speak different versions. Tell the user to run \`${UPDATE_COMMAND}\`; if the extension is the older one, Chrome updates it within a few hours, or they can reload it in chrome://extensions.`,
        );

  const server = createServer((socket) => {
    const id = nextSessionId++;
    const conn: SessionConn = { socket, parser: new FrameParser(), harness: "unknown AI tool" };
    sessions.set(id, conn);
    socket.on("data", (chunk: Buffer) => {
      for (const raw of conn.parser.push(chunk)) {
        const message = parseSessionToHost(raw);
        if (!message) continue;
        switch (message.type) {
          case "hello":
            conn.harness = message.harness;
            toSession(conn, welcomeSession());
            broadcastSessions();
            break;
          case "call": {
            if (!extensionReady) {
              toSession(conn, { type: "result", id: message.id, result: notConnected() });
              break;
            }
            const call: HostToExtension = { type: "call", id: `${id}:${message.id}`, tool: message.tool, args: message.args };
            const frame = encodeFrame(call);
            if (frame.length - 4 > MAX_MESSAGE_BYTES) toSession(conn, { type: "result", id: message.id, result: tooLarge(message.tool, frame.length - 4) });
            else process.stdout.write(frame);
            break;
          }
          case "reload":
            if (extensionReady) toExtension({ type: "reload" });
            break;
          case "restart":
            log("restart requested: exiting so Chrome starts the installed version");
            shutdown();
            break;
        }
      }
    });
    const drop = (): void => {
      if (sessions.delete(id)) broadcastSessions();
    };
    socket.on("close", drop);
    socket.on("error", drop);
  });

  server.on("error", (e) => log(`socket server error: ${e.message}`));
  server.listen(socketAddress(socketPath), () => {
    if (isWindows) writeFileSync(socketPath, "");
    else chmodSync(socketPath, 0o600);
    log(`listening on ${socketAddress(socketPath)}`);
  });

  // Regular traffic keeps the extension service worker alive; Chrome resets its idle timer on every port message.
  const pingTimer = setInterval(() => toExtension({ type: "ping" }), PING_INTERVAL_MS);
  void checkForUpdates();
  const updateTimer = setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);

  const shutdown = (): void => {
    clearInterval(pingTimer);
    clearInterval(updateTimer);
    for (const conn of sessions.values()) conn.socket.destroy();
    server.close();
    rmSync(socketPath, { force: true });
    log("exiting");
    process.exit(0);
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  log(`started pid ${process.pid}, v${VERSION}`);
}
