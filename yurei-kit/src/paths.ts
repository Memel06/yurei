import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_HOST_NAME } from "../../shared/protocol";

export const isWindows = process.platform === "win32";

export const yureiHome = (): string => join(homedir(), ".yurei");
export const hostLogPath = (): string => join(yureiHome(), "native-host.log");
/** On Windows the registry points at this single manifest; elsewhere a copy goes into each browser's folder. */
const hostManifestPath = (): string => join(yureiHome(), `${NATIVE_HOST_NAME}.json`);

/** The file currently running: an npx cache, a global npm install, or a checkout's build. */
export const scriptPath = (): string => fileURLToPath(import.meta.url);

/** Set when running from a checkout, whose build is then used in place so a rebuild needs no reinstall. */
function repoRoot(): string | null {
  const root = join(dirname(scriptPath()), "..", "..");
  return existsSync(join(root, "yurei-extension", "manifest.json")) ? root : null;
}

/** Where Chrome and the harnesses find the CLI: a checkout's build, or the copy `yurei setup` keeps in ~/.yurei. */
export const cliPath = (): string => (repoRoot() !== null ? scriptPath() : join(yureiHome(), "yurei.mjs"));

/** Chrome can only start an executable, and it appends its own arguments, so a small script runs the CLI. */
export const launcherPath = (): string => join(yureiHome(), isWindows ? "yurei.cmd" : "yurei");

/** The unpacked extension of a checkout; released users install it from the Chrome Web Store instead. */
export function extensionDir(): string | null {
  const root = repoRoot();
  if (root === null) return null;
  const dir = join(root, "yurei-extension", "dist");
  return existsSync(join(dir, "manifest.json")) ? dir : null;
}

export const ensureDir = (dir: string): string => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};

/** /tmp is shared, so a directory there is only trusted when it is a real directory of ours that nobody else can enter. */
export const isPrivateDir = (dir: string): boolean => {
  if (isWindows) return true;
  try {
    const stat = lstatSync(dir);
    return stat.isDirectory() && stat.uid === userInfo().uid && (stat.mode & 0o077) === 0;
  } catch {
    return false;
  }
};

const userTag = (): string => (isWindows ? userInfo().username.replace(/[^\w.-]/g, "_") : String(userInfo().uid));

/** Fixed location (not $TMPDIR) so a host spawned by Chrome and a session started from a terminal agree. */
export const socketDir = (): string => (isWindows ? join(yureiHome(), "hosts") : `/tmp/yurei-bridge-${userTag()}`);

const SOCKET_PREFIX = "host-";
export const hostSocketFile = (pid: number): string => join(socketDir(), `${SOCKET_PREFIX}${pid}.sock`);
export const isHostSocketFile = (name: string): boolean => name.startsWith(SOCKET_PREFIX) && name.endsWith(".sock");

/** Address the host listens on. Windows has no Unix sockets, so there the .sock file is only a marker for a named pipe. */
export const socketAddress = (socketFile: string): string =>
  isWindows ? `\\\\.\\pipe\\yurei-${userTag()}-${basename(socketFile, ".sock")}` : socketFile;

export type HostManifestTarget = {
  readonly browser: string;
  readonly file: string;
  /** Windows only: the key whose default value must hold the manifest path. */
  readonly registryKey: string | null;
  readonly browserInstalled: boolean;
};

type BrowserEntry = readonly [name: string, dir: string];

const posixTargets = (): ReadonlyArray<HostManifestTarget> => {
  const home = homedir();
  const mac = process.platform === "darwin";
  const base = mac
    ? join(home, "Library", "Application Support")
    : (process.env["XDG_CONFIG_HOME"] ?? join(home, ".config"));
  const browsers: ReadonlyArray<BrowserEntry> = mac
    ? [
        ["Google Chrome", "Google/Chrome"],
        ["Google Chrome Beta", "Google/Chrome Beta"],
        ["Google Chrome Canary", "Google/Chrome Canary"],
        ["Google Chrome Dev", "Google/Chrome Dev"],
        ["Chromium", "Chromium"],
        ["Brave", "BraveSoftware/Brave-Browser"],
        ["Microsoft Edge", "Microsoft Edge"],
        ["Arc", "Arc/User Data"],
        ["Vivaldi", "Vivaldi"],
      ]
    : [
        ["Google Chrome", "google-chrome"],
        ["Google Chrome Beta", "google-chrome-beta"],
        ["Chromium", "chromium"],
        ["Brave", "BraveSoftware/Brave-Browser"],
        ["Microsoft Edge", "microsoft-edge"],
        ["Vivaldi", "vivaldi"],
      ];
  return browsers.map(([browser, dir]) => ({
    browser,
    file: join(base, dir, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`),
    registryKey: null,
    browserInstalled: existsSync(join(base, dir)),
  }));
};

/** Registry keys of the Chromium-based browsers; their profile folders live under %LOCALAPPDATA%. */
const windowsTargets = (): ReadonlyArray<HostManifestTarget> => {
  const local = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local");
  const browsers: ReadonlyArray<readonly [name: string, dataDir: ReadonlyArray<string>, key: string]> = [
    ["Google Chrome", ["Google", "Chrome", "User Data"], "HKCU\\Software\\Google\\Chrome"],
    ["Chromium", ["Chromium", "User Data"], "HKCU\\Software\\Chromium"],
    ["Brave", ["BraveSoftware", "Brave-Browser", "User Data"], "HKCU\\Software\\BraveSoftware\\Brave-Browser"],
    ["Microsoft Edge", ["Microsoft", "Edge", "User Data"], "HKCU\\Software\\Microsoft\\Edge"],
    ["Arc", ["Arc", "User Data"], "HKCU\\Software\\ArcBrowser\\Arc"],
    ["Vivaldi", ["Vivaldi", "User Data"], "HKCU\\Software\\Vivaldi"],
  ];
  return browsers.map(([browser, dataDir, key]) => ({
    browser,
    file: hostManifestPath(),
    registryKey: `${key}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    browserInstalled: existsSync(join(local, ...dataDir)),
  }));
};

/** Where each Chromium-based browser looks for native messaging host manifests. Chrome itself is always included. */
export const hostManifestTargets = (): ReadonlyArray<HostManifestTarget> =>
  (isWindows ? windowsTargets() : posixTargets()).filter((t) => t.browserInstalled || t.browser === "Google Chrome");
