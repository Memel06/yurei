import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { after, test } from "node:test";
import { isRecord, PROTOCOL } from "../shared/protocol";
import { encodeFrame, FrameParser } from "../yurei-kit/src/framing";
import { hostSocketFile, socketAddress } from "../yurei-kit/src/paths";
import { useTempHome } from "./helpers";

const home = useTempHome();
const bundle = join(import.meta.dirname, "..", "yurei-kit", "dist", "yurei.mjs");
const TIMEOUT_MS = 8000;

const started: ChildProcess[] = [];
after(() => {
  for (const child of started) child.kill();
});

const run = (...args: ReadonlyArray<string>): ChildProcess => {
  assert.ok(existsSync(bundle), "yurei-kit/dist/yurei.mjs is missing: run npm run build first");
  const child = spawn(process.execPath, [bundle, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, HOME: home(), USERPROFILE: home(), YUREI_NO_UPDATE_CHECK: "1" },
  });
  started.push(child);
  return child;
};

const waitFor = <T>(what: string, poll: () => T | null): Promise<T> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + TIMEOUT_MS;
    const tick = (): void => {
      const value = poll();
      if (value !== null) {
        resolve(value);
        return;
      }
      if (Date.now() > deadline) reject(new Error(`timed out waiting for ${what}`));
      else setTimeout(tick, 50);
    };
    tick();
  });

/** Plays the extension: Chrome's end of the native messaging pipes, with every frame the host sent kept. */
const asExtension = (host: ChildProcess) => {
  const parser = new FrameParser();
  const seen: Record<string, unknown>[] = [];
  host.stdout?.on("data", (chunk: Buffer) => {
    for (const raw of parser.push(chunk)) if (isRecord(raw)) seen.push(raw);
  });
  return {
    send: (message: unknown): void => void host.stdin?.write(encodeFrame(message)),
    /** The newest frame of this type, so a later broadcast is not shadowed by an earlier one. */
    last: (type: string): Record<string, unknown> | null => seen.filter((m) => m["type"] === type).at(-1) ?? null,
  };
};

test("the host lists harness sessions and clears them when the popup asks", async () => {
  const host = run("native-host");
  const extension = asExtension(host);
  const socket = await waitFor("the host socket", () => {
    const file = hostSocketFile(host.pid ?? 0);
    return existsSync(file) ? file : null;
  });

  extension.send({ type: "hello", protocol: PROTOCOL, extensionId: "test", version: "0.0.0" });
  const welcome = await waitFor("welcome", () => extension.last("welcome"));
  assert.equal(welcome["protocol"], PROTOCOL);
  assert.deepEqual(welcome["sessions"], []);

  const session = createConnection(socketAddress(socket));
  let sessionOpen = true;
  // A paused socket never reads the peer's FIN, so it would not notice being dropped. Real sessions read replies.
  session.resume();
  session.on("close", () => (sessionOpen = false));
  await waitFor("the session to connect", () => (session.connecting ? null : true));
  session.write(encodeFrame({ type: "hello", protocol: PROTOCOL, harness: "fake-tool" }));
  const listed = await waitFor("the session list", () => {
    const message = extension.last("sessions");
    return Array.isArray(message?.["sessions"]) && message["sessions"].length === 1 ? message : null;
  });
  assert.deepEqual(listed["sessions"], [{ harness: "fake-tool" }]);

  extension.send({ type: "drop-sessions" });
  await waitFor("the session socket to close", () => (sessionOpen ? null : true));
  const cleared = await waitFor("the empty session list", () => {
    const message = extension.last("sessions");
    return Array.isArray(message?.["sessions"]) && message["sessions"].length === 0 ? message : null;
  });
  assert.deepEqual(cleared["sessions"], []);
});

test("serve exits when the AI tool that spawned it goes away", async () => {
  const serve = run("serve");
  await waitFor("serve to start", () => (serve.exitCode === null && serve.pid !== undefined ? true : null));
  serve.stdin?.end();
  const code = await waitFor("serve to exit", () => serve.exitCode);
  assert.equal(code, 0);
});
