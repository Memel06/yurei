import { spawn } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isRecord } from "../../shared/protocol";
import { SKILL_MD, SKILL_NAME } from "./guide";
import { cliPath, isWindows, launcherPath } from "./paths";

export const HARNESS_IDS = ["opencode", "pi", "cursor", "windsurf", "codex", "generic"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];
export const isHarnessId = (v: string): v is HarnessId => (HARNESS_IDS as ReadonlyArray<string>).includes(v);

/**
 * Absolute paths only: tools launched from a GUI do not inherit a shell PATH. The launcher finds node itself, which
 * survives Node upgrades; Windows MCP clients cannot all spawn a .cmd, so there node runs the CLI directly.
 */
const serverCommand = (): { readonly command: string; readonly args: ReadonlyArray<string> } =>
  isWindows ? { command: process.execPath, args: [cliPath(), "serve"] } : { command: launcherPath(), args: ["serve"] };

const configHome = (): string => process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");

const isExecutable = (file: string): boolean => {
  try {
    accessSync(file, isWindows ? constants.F_OK : constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

export function findCommand(name: string): string | null {
  const exts = isWindows ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env["PATH"] ?? "").split(isWindows ? ";" : ":")) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = join(dir, `${name}${ext}`);
      if (isExecutable(file)) return file;
    }
  }
  return null;
}

const anyExists = (...paths: ReadonlyArray<string>): boolean => paths.some((p) => existsSync(p));

export type Progress = (message: string) => void;

const RUN_TIMEOUT_MS = 120_000;

/** Runs a command to the end, surfacing its latest output line as progress; on failure the error carries the output's tail. */
function run(command: string, args: ReadonlyArray<string>, progress: Progress): Promise<void> {
  return new Promise((resolve, reject) => {
    // Chrome-launched or GUI-launched tools inherit no stdin worth reading; a .cmd on Windows only starts through a shell.
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"], shell: isWindows, windowsHide: true });
    let output = "";
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      const last = output.trimEnd().split("\n").at(-1)?.trim();
      if (last) progress(last);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`gave up after ${RUN_TIMEOUT_MS / 1000}s`));
    }, RUN_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(output.trim().split("\n").slice(-3).join(" ") || `exit code ${code}`));
    });
  });
}

/** JSONC to JSON in one string-aware pass: comments and trailing commas go, string contents are never touched. */
function stripJsonComments(source: string): { readonly json: string; readonly hadComments: boolean } {
  let out = "";
  let inString = false;
  let hadComments = false;
  let pendingComma = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next;
        i++;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === "/" && next === "/") {
      hadComments = true;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      hadComments = true;
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      out += ch;
      continue;
    }
    // A comma is held back until the next token shows whether it was trailing.
    if (pendingComma && ch !== "}" && ch !== "]") out += ",";
    pendingComma = ch === ",";
    if (pendingComma) continue;
    if (ch === '"') inString = true;
    out += ch;
  }
  return { json: out, hadComments };
}

function readJsonConfig(file: string): { readonly config: Record<string, unknown>; readonly hadComments: boolean } {
  if (!existsSync(file)) return { config: {}, hadComments: false };
  const stripped = stripJsonComments(readFileSync(file, "utf8"));
  const config: unknown = JSON.parse(stripped.json || "{}");
  if (!isRecord(config)) throw new Error(`${file} is not a JSON object`);
  return { config, hadComments: stripped.hadComments };
}

/** A sibling temp file renamed into place, so a crash mid-write never leaves a truncated config; symlinks are written through. */
function writeAtomic(file: string, content: string, defaultMode: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const exists = existsSync(file);
  const target = exists ? realpathSync(file) : file;
  const mode = exists ? statSync(target).mode & 0o777 : defaultMode;
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
  writeFileSync(tmp, content);
  chmodSync(tmp, mode);
  renameSync(tmp, target);
}

/** Adds one entry to a JSON(C) config without disturbing the rest of it. Comments cannot survive the rewrite. */
function patchJsonConfig(file: string, patch: (config: Record<string, unknown>) => void): string {
  const { config, hadComments } = readJsonConfig(file);
  patch(config);
  writeAtomic(file, `${JSON.stringify(config, null, 2)}\n`, 0o644);
  return hadComments ? `${file} (comments were removed while rewriting it)` : file;
}

const patchMcpServers = (file: string): string =>
  patchJsonConfig(file, (config) => {
    const existing = config["mcpServers"];
    const servers: Record<string, unknown> = isRecord(existing) ? existing : {};
    servers["yurei"] = serverCommand();
    config["mcpServers"] = servers;
  });

function configureOpencode(): string {
  const dir = join(configHome(), "opencode");
  const existing = [join(dir, "opencode.jsonc"), join(dir, "opencode.json")].find((p) => existsSync(p));
  const file = existing ?? join(dir, "opencode.json");
  const { command, args } = serverCommand();
  return patchJsonConfig(file, (config) => {
    const existing = config["mcp"];
    const mcp: Record<string, unknown> = isRecord(existing) ? existing : {};
    mcp["yurei"] = { type: "local", command: [command, ...args], enabled: true };
    config["mcp"] = mcp;
  });
}

const PI_AGENT_DIR = (): string => join(homedir(), ".pi", "agent");
const PI_ADAPTER = "npm:pi-mcp-adapter";

const piHasAdapter = (): boolean => {
  const { config } = readJsonConfig(join(PI_AGENT_DIR(), "settings.json"));
  const packages = config["packages"];
  return (
    Array.isArray(packages) &&
    packages.some((p: unknown) => (typeof p === "string" ? p : isRecord(p) ? p["source"] : null) === PI_ADAPTER)
  );
};

/** pi has no MCP support of its own; the pi-mcp-adapter package reads ~/.pi/agent/mcp.json. */
async function configurePi(progress: Progress): Promise<string> {
  const file = patchMcpServers(join(PI_AGENT_DIR(), "mcp.json"));
  if (piHasAdapter()) return file;
  const pi = findCommand("pi");
  if (!pi) return `${file} (then run: pi install ${PI_ADAPTER})`;
  progress(`pi install ${PI_ADAPTER}`);
  try {
    await run(pi, ["install", PI_ADAPTER], progress);
  } catch (e) {
    throw new Error(
      `${file} is written, but pi could not install ${PI_ADAPTER} (${e instanceof Error ? e.message : String(e)}). Run: pi install ${PI_ADAPTER}`,
    );
  }
  return `${file} + ${PI_ADAPTER}`;
}

const tomlString = (s: string): string => JSON.stringify(s);
const codexBlock = (): string => {
  const { command, args } = serverCommand();
  return [
    `[mcp_servers.yurei]`,
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
  ].join("\n");
};

/** Replaces or appends the `[mcp_servers.yurei]` table, leaving every other line of the file untouched. */
function configureCodex(): string {
  const file = join(homedir(), ".codex", "config.toml");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = before.split("\n");
  const start = lines.findIndex((line) => /^\s*\[mcp_servers\.yurei\]/.test(line));
  let rest = before;
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end] ?? "")) end++;
    rest = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  }
  const body = rest.replace(/\n+$/, "");
  writeAtomic(file, `${body ? `${body}\n\n` : ""}${codexBlock()}\n`, 0o600);
  return file;
}

/** Read by opencode, pi, Cursor and Codex alike; it tells the model when to reach for the browser. */
export function installSkill(): string {
  const file = join(homedir(), ".agents", "skills", SKILL_NAME, "SKILL.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SKILL_MD);
  return file;
}

export type Harness = {
  readonly id: HarnessId;
  readonly name: string;
  /** Where the config goes, shown next to the name when picking tools. */
  readonly hint: string;
  /** True when this tool looks installed for this user. */
  readonly installed: () => boolean;
  /** Writes the config and returns what it did; null when only a printable snippet exists. */
  readonly configure: ((progress: Progress) => Promise<string>) | null;
  readonly snippet: () => string;
};

const mcpServersSnippet = (where: string): string => {
  const { command, args } = serverCommand();
  return `${JSON.stringify({ mcpServers: { yurei: { command, args } } }, null, 2)}\n\n${where}`;
};

export const HARNESSES: ReadonlyArray<Harness> = [
  {
    id: "opencode",
    name: "opencode",
    hint: "~/.config/opencode/opencode.json",
    installed: () => findCommand("opencode") !== null || existsSync(join(configHome(), "opencode")),
    configure: async () => configureOpencode(),
    snippet: () => {
      const { command, args } = serverCommand();
      return `${JSON.stringify({ mcp: { yurei: { type: "local", command: [command, ...args], enabled: true } } }, null, 2)}

Add the "mcp" block to ~/.config/opencode/opencode.json (or .jsonc).`;
    },
  },
  {
    id: "pi",
    name: "pi",
    hint: `~/.pi/agent/mcp.json + ${PI_ADAPTER}`,
    installed: () => findCommand("pi") !== null || existsSync(PI_AGENT_DIR()),
    configure: configurePi,
    snippet: () =>
      mcpServersSnippet(`Save as ~/.pi/agent/mcp.json, and install the MCP adapter once: pi install ${PI_ADAPTER}`),
  },
  {
    id: "cursor",
    name: "Cursor",
    hint: "~/.cursor/mcp.json",
    installed: () =>
      anyExists(join(homedir(), ".cursor"), "/Applications/Cursor.app") || findCommand("cursor") !== null,
    configure: async () => patchMcpServers(join(homedir(), ".cursor", "mcp.json")),
    snippet: () => mcpServersSnippet("Save as ~/.cursor/mcp.json (all projects) or <project>/.cursor/mcp.json."),
  },
  {
    id: "windsurf",
    name: "Windsurf",
    hint: "~/.codeium/windsurf/mcp_config.json",
    installed: () =>
      anyExists(join(homedir(), ".codeium", "windsurf"), "/Applications/Windsurf.app") ||
      findCommand("windsurf") !== null,
    configure: async () => patchMcpServers(join(homedir(), ".codeium", "windsurf", "mcp_config.json")),
    snippet: () => mcpServersSnippet("Merge into ~/.codeium/windsurf/mcp_config.json."),
  },
  {
    id: "codex",
    name: "Codex CLI",
    hint: "~/.codex/config.toml",
    installed: () => findCommand("codex") !== null || existsSync(join(homedir(), ".codex")),
    configure: async () => configureCodex(),
    snippet: () => `${codexBlock()}\n\nAppend to ~/.codex/config.toml.`,
  },
  {
    id: "generic",
    name: "any other MCP client",
    hint: "",
    installed: () => false,
    configure: null,
    snippet: () =>
      mcpServersSnippet(
        "Any MCP client that can launch a local stdio server accepts this shape (Zed, Continue, Cline, Gemini CLI, ...).",
      ),
  },
];

export const harnessById = (id: HarnessId): Harness => {
  const found = HARNESSES.find((h) => h.id === id);
  if (!found) throw new Error(`unknown tool ${id}`);
  return found;
};

export const detectHarnesses = (): ReadonlyArray<Harness> => HARNESSES.filter((h) => h.installed());
