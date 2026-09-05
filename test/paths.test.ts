import assert from "node:assert/strict";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  ensureDir,
  hostManifestTargets,
  hostSocketFile,
  isHostSocketFile,
  isPrivateDir,
  socketAddress,
  socketDir,
} from "../yurei-kit/src/paths";
import { useTempHome } from "./helpers";

const home = useTempHome();
const posix = process.platform !== "win32";

test("host socket files are recognised by name", () => {
  assert.equal(isHostSocketFile("host-123.sock"), true);
  assert.equal(isHostSocketFile("host-1.txt"), false);
  assert.equal(isHostSocketFile("other-1.sock"), false);
  assert.equal(hostSocketFile(42), join(socketDir(), "host-42.sock"));
});

test("socketAddress is the file itself on POSIX and a named pipe on Windows", () => {
  const file = hostSocketFile(7);
  if (posix) assert.equal(socketAddress(file), file);
  else assert.match(socketAddress(file), /^\\\\\.\\pipe\\yurei-.+-host-7$/);
});

test("isPrivateDir wants a directory of ours that nobody else can enter", { skip: !posix }, () => {
  const dir = join(home(), "private");
  mkdirSync(dir, { mode: 0o700 });
  assert.equal(isPrivateDir(dir), true);
  chmodSync(dir, 0o755);
  assert.equal(isPrivateDir(dir), false);
  chmodSync(dir, 0o750);
  assert.equal(isPrivateDir(dir), false);
  const file = join(home(), "file");
  writeFileSync(file, "");
  chmodSync(file, 0o600);
  assert.equal(isPrivateDir(file), false);
  assert.equal(isPrivateDir(join(home(), "missing")), false);
});

test("ensureDir creates the directory private", { skip: !posix }, () => {
  const dir = ensureDir(join(home(), "a", "b"));
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(ensureDir(dir), dir);
});

test("Chrome is always a manifest target and every target is the bridge manifest", () => {
  const targets = hostManifestTargets();
  assert.ok(targets.some((t) => t.browser === "Google Chrome"));
  for (const target of targets) {
    assert.ok(target.file.endsWith("com.yurei.bridge.json"));
    assert.equal(target.registryKey === null, posix);
  }
});
