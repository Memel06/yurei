import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { EXTENSION_ID, NATIVE_HOST_NAME, UNPACKED_EXTENSION_ID } from "../../shared/protocol";
import { cliPath, ensureDir, hostManifestTargets, isWindows, launcherPath, scriptPath, yureiHome, type HostManifestTarget } from "./paths";

export type InstallReport = {
  readonly launcher: string;
  readonly browsers: ReadonlyArray<string>;
  /** `yurei` on the PATH-friendly ~/.local/bin; null on Windows or when something that is not ours already sits there. */
  readonly command: string | null;
  readonly warning: string | null;
};

/** Keeps a stable copy of the CLI in ~/.yurei: an npx cache or a global npm install can move or vanish. */
function installCli(): string {
  const target = cliPath();
  if (target === scriptPath()) return target;
  ensureDir(yureiHome());
  copyFileSync(scriptPath(), target);
  return target;
}

// In a batch file % starts a variable reference, so a literal % must be doubled.
const batchQuote = (s: string): string => `"${s.replaceAll("%", "%%")}"`;

const launcherScript = (cli: string): string => {
  if (isWindows) return `@echo off\r\n${batchQuote(process.execPath)} ${batchQuote(cli)} %*\r\n`;
  // Chrome starts the host with a near-empty PATH, and version managers move node around:
  // prefer the node that ran setup, then look in the usual install locations.
  return [
    "#!/bin/sh",
    `NODE="${process.execPath}"`,
    `[ -x "$NODE" ] || NODE=$(PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin" command -v node) || exit 1`,
    `exec "$NODE" "${cli}" "$@"`,
    "",
  ].join("\n");
};

/** Chrome on Windows finds native hosts through the registry: the key's default value is the manifest path. */
function registerInRegistry(key: string, manifestFile: string): void {
  try {
    execFileSync("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", manifestFile, "/f"], { stdio: "ignore" });
  } catch (e) {
    throw new Error(`Could not write ${key} to the Windows registry: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function isRegistered(key: string): boolean {
  try {
    execFileSync("reg", ["query", key, "/ve"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function linkCommand(launcher: string): Pick<InstallReport, "command" | "warning"> {
  if (isWindows) return { command: null, warning: null };
  const link = join(homedir(), ".local", "bin", "yurei");
  mkdirSync(dirname(link), { recursive: true });
  if (existsSync(link) && !lstatSync(link).isSymbolicLink()) {
    return { command: null, warning: `${link} already exists and is not a symlink, so it was left untouched` };
  }
  rmSync(link, { force: true });
  symlinkSync(launcher, link);
  return { command: link, warning: null };
}

/** The script Chrome's manifest and every generated MCP config point at; it runs the CLI copy kept next to it. */
export function installLauncher(): string {
  const cli = installCli();
  const launcher = launcherPath();
  ensureDir(yureiHome());
  writeFileSync(launcher, launcherScript(cli));
  if (!isWindows) chmodSync(launcher, 0o755);
  return launcher;
}

/** Registers the launcher with every Chromium-based browser found, so Chrome can start `yurei native-host` for the extension. */
export function installNativeHost(): InstallReport {
  const launcher = installLauncher();
  const manifest = {
    name: NATIVE_HOST_NAME,
    description: "Yurei bridge between the Chrome extension and your AI tool",
    path: launcher,
    type: "stdio",
    // Chrome sees the store build and a folder loaded unpacked as two different extensions.
    allowed_origins: [EXTENSION_ID, UNPACKED_EXTENSION_ID].map((id) => `chrome-extension://${id}/`),
  };
  const browsers: string[] = [];
  for (const target of hostManifestTargets()) {
    mkdirSync(dirname(target.file), { recursive: true });
    writeFileSync(target.file, `${JSON.stringify(manifest, null, 2)}\n`);
    if (target.registryKey) registerInRegistry(target.registryKey, target.file);
    browsers.push(target.browser);
  }
  return { launcher, browsers, ...linkCommand(launcher) };
}

export const installedManifests = (): ReadonlyArray<HostManifestTarget> =>
  hostManifestTargets().filter((t) => existsSync(t.file) && (t.registryKey === null || isRegistered(t.registryKey)));
