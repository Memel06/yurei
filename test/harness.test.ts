import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TOOL_NAMES } from "../shared/protocol";
import { SKILL_MD } from "../yurei-kit/src/guide";
import { findCommand, forShell, HARNESSES, harnessById, installSkill, isHarnessId } from "../yurei-kit/src/harness";
import { launcherPath } from "../yurei-kit/src/paths";
import { field, parseJson, useTempHome } from "./helpers";

const home = useTempHome();
const posix = process.platform !== "win32";
const noProgress = (): void => undefined;

const write = (file: string, content: string, mode?: number): void => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
  if (mode !== undefined) chmodSync(file, mode);
};

test("isHarnessId and harnessById", () => {
  assert.equal(isHarnessId("cursor"), true);
  assert.equal(isHarnessId("vim"), false);
  assert.equal(harnessById("codex").name, "Codex CLI");
  assert.equal(HARNESSES.map((h) => h.id).join(","), "opencode,pi,cursor,windsurf,codex,generic");
});

test("cursor: a JSONC config keeps its other servers, loses its comments and says so", async () => {
  const file = join(home(), ".cursor", "mcp.json");
  write(file, `{\n  // my servers\n  "mcpServers": {\n    "other": { "command": "x", "args": [] },\n  },\n}\n`, 0o600);
  const configure = harnessById("cursor").configure;
  assert.ok(configure);
  const report = await configure(noProgress);
  assert.equal(report, `${file} (comments were removed while rewriting it)`);
  const config = parseJson(readFileSync(file, "utf8"));
  assert.deepEqual(field(config, "mcpServers", "other"), { command: "x", args: [] });
  if (posix) {
    assert.deepEqual(field(config, "mcpServers", "yurei"), { command: launcherPath(), args: ["serve"] });
    assert.equal(statSync(file).mode & 0o777, 0o600, "the file keeps its mode");
  }
});

test("a config that is a symlink is written through, not replaced", { skip: !posix }, async () => {
  const real = join(home(), "dotfiles", "windsurf.json");
  write(real, `{"mcpServers":{}}`);
  const link = join(home(), ".codeium", "windsurf", "mcp_config.json");
  mkdirSync(join(link, ".."), { recursive: true });
  symlinkSync(real, link);
  const configure = harnessById("windsurf").configure;
  assert.ok(configure);
  assert.equal(await configure(noProgress), link);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.ok(field(parseJson(readFileSync(real, "utf8")), "mcpServers", "yurei"));
});

test("opencode: an existing .jsonc wins over creating .json, and the entry is opencode-shaped", async () => {
  const dir = join(home(), ".config", "opencode");
  write(join(dir, "opencode.jsonc"), `{ "theme": "dark" }`);
  const configure = harnessById("opencode").configure;
  assert.ok(configure);
  assert.equal(await configure(noProgress), join(dir, "opencode.jsonc"));
  assert.equal(existsSync(join(dir, "opencode.json")), false);
  const config = parseJson(readFileSync(join(dir, "opencode.jsonc"), "utf8"));
  assert.equal(field(config, "theme"), "dark");
  assert.equal(field(config, "mcp", "yurei", "type"), "local");
  assert.equal(field(config, "mcp", "yurei", "enabled"), true);
  const command = field(config, "mcp", "yurei", "command");
  assert.ok(Array.isArray(command));
  assert.equal(command.at(-1), "serve");
});

test("codex: the yurei table is appended once and replaced in place on a second run", async () => {
  const file = join(home(), ".codex", "config.toml");
  write(
    file,
    `model = "o3"\n\n[mcp_servers.yurei]\ncommand = "old"\nargs = []\n\n[mcp_servers.other]\ncommand = "keep"\n`,
  );
  const configure = harnessById("codex").configure;
  assert.ok(configure);
  assert.equal(await configure(noProgress), file);
  const toml = readFileSync(file, "utf8");
  assert.equal(toml.match(/\[mcp_servers\.yurei\]/g)?.length, 1);
  assert.ok(toml.startsWith('model = "o3"\n'));
  assert.ok(toml.includes('[mcp_servers.other]\ncommand = "keep"'));
  assert.ok(!toml.includes('command = "old"'));
  assert.match(toml, /\[mcp_servers\.yurei\]\ncommand = ".+"\nargs = \[.*"serve"\]\n$/);
  await configure(noProgress);
  assert.equal(readFileSync(file, "utf8"), toml, "a second run is a no-op");
});

test("codex: a fresh config is created private", { skip: !posix }, async () => {
  const file = join(home(), ".codex", "config.toml");
  rmSync(file, { force: true });
  const configure = harnessById("codex").configure;
  assert.ok(configure);
  await configure(noProgress);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("pi: the adapter is only requested when settings.json does not list it", async () => {
  const savedPath = process.env["PATH"];
  process.env["PATH"] = "";
  try {
    const configure = harnessById("pi").configure;
    assert.ok(configure);
    const file = join(home(), ".pi", "agent", "mcp.json");
    assert.equal(await configure(noProgress), `${file} (then run: pi install npm:pi-mcp-adapter)`);
    assert.ok(field(parseJson(readFileSync(file, "utf8")), "mcpServers", "yurei"));
    write(join(home(), ".pi", "agent", "settings.json"), `{"packages":["npm:pi-mcp-adapter"]}`);
    assert.equal(await configure(noProgress), file);
    write(join(home(), ".pi", "agent", "settings.json"), `{"packages":[{"source":"npm:pi-mcp-adapter"}]}`);
    assert.equal(await configure(noProgress), file);
  } finally {
    process.env["PATH"] = savedPath;
  }
});

test("every snippet is printable and the JSON ones parse", () => {
  for (const harness of HARNESSES) {
    const snippet = harness.snippet();
    assert.ok(snippet.length > 0, harness.id);
    if (harness.id === "codex") {
      assert.match(snippet, /^\[mcp_servers\.yurei\]\ncommand = ".+"\nargs = \[.+\]\n/);
      continue;
    }
    const json = parseJson(snippet.split("\n\n")[0] ?? "");
    const entry = harness.id === "opencode" ? field(json, "mcp", "yurei") : field(json, "mcpServers", "yurei");
    assert.ok(entry, harness.id);
  }
});

test("the skill names every tool and carries the guide", () => {
  const file = installSkill();
  assert.equal(file, join(home(), ".agents", "skills", "yurei", "SKILL.md"));
  const skill = readFileSync(file, "utf8");
  assert.equal(skill, SKILL_MD);
  assert.ok(skill.startsWith("---\nname: yurei\n"));
  for (const tool of TOOL_NAMES) assert.ok(skill.includes(tool), tool);
  assert.ok(skill.includes("never accept cookies on your own"));
});

test("findCommand walks PATH and wants an executable file", { skip: !posix }, () => {
  const bin = join(home(), "bin");
  write(join(bin, "pi"), "#!/bin/sh\n", 0o755);
  write(join(bin, "notexec"), "", 0o644);
  mkdirSync(join(bin, "adir"));
  const savedPath = process.env["PATH"];
  process.env["PATH"] = `:${bin}:/nonexistent`;
  try {
    assert.equal(findCommand("pi"), join(bin, "pi"));
    assert.equal(findCommand("notexec"), null);
    assert.equal(findCommand("adir"), null);
    assert.equal(findCommand("missing"), null);
  } finally {
    process.env["PATH"] = savedPath;
  }
});

test("forShell quotes only where a shell would split on spaces", () => {
  const input = { command: "C:\\Program Files\\nodejs\\npx.cmd", args: ["--yes", "yurei-chrome@0.4.0", "update"] };
  const quoted = forShell(input);
  if (posix) assert.deepEqual(quoted, input);
  else
    assert.deepEqual(quoted, {
      command: '"C:\\Program Files\\nodejs\\npx.cmd"',
      args: ['"--yes"', '"yurei-chrome@0.4.0"', '"update"'],
    });
});
