import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { field, parseJson, useTempHome } from "./helpers";

const home = useTempHome();
const root = join(import.meta.dirname, "..");
const bundle = join(root, "yurei-kit", "dist", "yurei.mjs");

const yurei = (
  ...args: ReadonlyArray<string>
): { readonly status: number | null; readonly out: string; readonly err: string } => {
  assert.ok(existsSync(bundle), "yurei-kit/dist/yurei.mjs is missing: run npm run build first");
  const run = spawnSync(process.execPath, [bundle, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home(), USERPROFILE: home(), NO_COLOR: "1" },
  });
  return { status: run.status, out: run.stdout, err: run.stderr };
};

test("version and help", () => {
  const version = field(parseJson(readFileSync(join(root, "yurei-kit", "package.json"), "utf8")), "version");
  assert.equal(yurei("version").out.trim(), version);
  assert.equal(yurei("--version").out.trim(), version);
  const help = yurei("help");
  assert.equal(help.status, 0);
  assert.ok(help.out.includes("yurei setup"));
  assert.ok(help.out.includes("npx yurei-chrome setup"));
  assert.equal(yurei().status, 0);
});

test("unknown commands and bad arguments exit 1 with a usage line", () => {
  const unknown = yurei("dance");
  assert.equal(unknown.status, 1);
  assert.match(unknown.err, /unknown command "dance"/);
  assert.match(yurei("config", "vim").err, /config needs one of: opencode, pi, cursor, windsurf, codex, generic/);
  assert.match(yurei("call", "rm_rf").err, /usage: yurei call/);
  assert.match(yurei("call", "navigate", "[1]").err, /args must be a JSON object/);
  assert.equal(yurei("call", "navigate", "{bad").status, 1);
});

test("config prints a client snippet and installs the launcher and skill under the home", () => {
  const generic = yurei("config", "generic");
  assert.equal(generic.status, 0);
  const snippet = parseJson(generic.out.split("\n\n")[0] ?? "");
  const args = field(snippet, "mcpServers", "yurei", "args");
  assert.deepEqual(args, ["serve"]);
  assert.ok(generic.out.includes("Skill installed at"));
  const launcher = join(home(), ".yurei", process.platform === "win32" ? "yurei.cmd" : "yurei");
  assert.ok(existsSync(launcher), "launcher written");
  if (process.platform !== "win32") assert.equal(statSync(launcher).mode & 0o111, 0o111);
  assert.ok(existsSync(join(home(), ".agents", "skills", "yurei", "SKILL.md")));
  assert.equal(yurei("config", "codex").out.split("\n")[0], "[mcp_servers.yurei]");
});
