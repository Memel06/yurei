import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { EXTENSION_ID, UNPACKED_EXTENSION_ID } from "../shared/protocol";
import { installedManifests, installLauncher, installNativeHost } from "../yurei-kit/src/install";
import { cliPath, launcherPath } from "../yurei-kit/src/paths";
import { field, parseJson, useTempHome } from "./helpers";

const home = useTempHome();
const posix = process.platform !== "win32";

test("the launcher is a shell script that finds node and forwards every argument", { skip: !posix }, () => {
  const launcher = installLauncher();
  assert.equal(launcher, launcherPath());
  assert.equal(statSync(launcher).mode & 0o111, 0o111);
  const script = readFileSync(launcher, "utf8");
  assert.ok(script.startsWith("#!/bin/sh\n"));
  assert.ok(script.includes(`NODE="${process.execPath}"`));
  assert.ok(script.includes("command -v node"));
  assert.ok(script.endsWith(`exec "$NODE" "${cliPath()}" "$@"\n`));
});

test("installNativeHost registers Chrome, whitelists both extension ids and links the command", {
  skip: !posix,
}, () => {
  const report = installNativeHost();
  assert.ok(report.browsers.includes("Google Chrome"));
  assert.equal(report.warning, null);
  assert.equal(report.command, join(home(), ".local", "bin", "yurei"));
  assert.ok(lstatSync(report.command).isSymbolicLink());
  assert.equal(readlinkSync(report.command), report.launcher);
  const manifests = installedManifests();
  assert.ok(manifests.length >= 1);
  for (const target of manifests) {
    assert.ok(target.file.startsWith(home()), `manifest stays under the temp home: ${target.file}`);
    const manifest = parseJson(readFileSync(target.file, "utf8"));
    assert.equal(field(manifest, "name"), "com.yurei.bridge");
    assert.equal(field(manifest, "type"), "stdio");
    assert.equal(field(manifest, "path"), report.launcher);
    assert.deepEqual(field(manifest, "allowed_origins"), [
      `chrome-extension://${EXTENSION_ID}/`,
      `chrome-extension://${UNPACKED_EXTENSION_ID}/`,
    ]);
  }
});

test("a foreign file at ~/.local/bin/yurei is left alone and reported", { skip: !posix }, () => {
  const link = join(home(), ".local", "bin", "yurei");
  mkdirSync(join(link, ".."), { recursive: true });
  rmSync(link, { force: true });
  writeFileSync(link, "#!/bin/sh\necho someone else\n");
  const report = installNativeHost();
  assert.equal(report.command, null);
  assert.match(report.warning ?? "", /already exists and is not a symlink/);
  assert.equal(readFileSync(link, "utf8"), "#!/bin/sh\necho someone else\n");
  assert.ok(existsSync(report.launcher));
});
