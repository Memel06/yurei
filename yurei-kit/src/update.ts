import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:https";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";
import { isRecord } from "../../shared/protocol";
import { isNewer } from "../../shared/semver";
import { findCommand, installSkill } from "./harness";
import { HostClient } from "./host-client";
import { installNativeHost } from "./install";
import { ensureDir, isWindows, yureiHome } from "./paths";
import { bold, cmd, dim, shu, spinner } from "./ui";
import { VERSION } from "./version";

const REGISTRY_URL = "https://registry.npmjs.org/yurei-chrome/latest";
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const RESTART_WAIT_MS = 20_000;

type Cache = { readonly checkedAt: number; readonly latest: string };

const cacheFile = (): string => join(yureiHome(), "update-check.json");

function readCache(): Cache | null {
  try {
    if (!existsSync(cacheFile())) return null;
    const v: unknown = JSON.parse(readFileSync(cacheFile(), "utf8"));
    return isRecord(v) && typeof v["checkedAt"] === "number" && typeof v["latest"] === "string"
      ? { checkedAt: v["checkedAt"], latest: v["latest"] }
      : null;
  } catch {
    return null;
  }
}

function fetchLatest(): Promise<string | null> {
  return new Promise((resolve) => {
    const request = get(
      REGISTRY_URL,
      { headers: { accept: "application/json" }, timeout: FETCH_TIMEOUT_MS },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () => {
          try {
            const v: unknown = JSON.parse(body);
            resolve(isRecord(v) && typeof v["version"] === "string" ? v["version"] : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

export const updateChecksDisabled = (): boolean => Boolean(process.env["YUREI_NO_UPDATE_CHECK"]);

/** The newest version on npm, asked at most once a day; null when unknown. Forcing skips the cache and the opt-out. */
export async function latestVersion(force = false): Promise<string | null> {
  if (!force && updateChecksDisabled()) return null;
  const cached = readCache();
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_EVERY_MS) return cached.latest;
  const latest = await fetchLatest();
  if (latest === null) return cached?.latest ?? null;
  try {
    ensureDir(yureiHome());
    writeFileSync(cacheFile(), JSON.stringify({ checkedAt: Date.now(), latest }));
  } catch {
    // A read-only home only costs an extra request tomorrow.
  }
  return latest;
}

/** After an update the host process Chrome started is still the old file; asking it to exit makes Chrome start the new one. */
export async function refreshHost(client: HostClient): Promise<boolean> {
  if (client.hostVersion === VERSION) return true;
  const s = spinner();
  const previous = client.hostVersion ? `v${client.hostVersion}` : "an older version";
  s.start(`Restarting the native host (${previous} → v${VERSION})`);
  // Hosts before 0.3 neither say their version nor answer to restart.
  if (client.hostVersion && (await client.restartHost())) {
    const deadline = Date.now() + RESTART_WAIT_MS;
    while (Date.now() < deadline) {
      // The old socket stays open for a moment; without a real pause its close event would never get a turn.
      await new Promise((r) => setTimeout(r, 300));
      if ((await client.waitForExtension(1000)) && client.hostVersion === VERSION) {
        s.stop(`Native host v${VERSION} is running`);
        return true;
      }
    }
  }
  s.stop(
    `The native host still runs ${previous}. Reload Yurei in chrome://extensions, or restart Chrome, to finish the update.`,
    1,
  );
  return false;
}

const npxPath = (): string | null => {
  const beside = join(dirname(process.execPath), isWindows ? "npx.cmd" : "npx");
  return existsSync(beside) ? beside : findCommand("npx");
};

/** `yurei update`: when a newer version is on npm, fetch it through npx and let it install itself; otherwise install this one. */
export async function runUpdate(): Promise<number> {
  p.intro(`${bold("yurei update")} ${dim(`v${VERSION}`)}`);
  const s = spinner();
  s.start("Asking npm for the newest version");
  const latest = await latestVersion(true);
  if (latest === null) {
    s.stop("Could not reach the npm registry", 2);
    p.log.message(`Try again later, or run ${cmd("npx yurei-chrome@latest update")} once you are online.`);
    return 1;
  }
  if (isNewer(latest, VERSION)) {
    s.stop(`v${latest} is out (this is v${VERSION})`);
    const npx = npxPath();
    if (npx === null) {
      p.log.error(
        `npx was not found. Run ${cmd(`npx yurei-chrome@${latest} update`)} in a terminal where npm is available.`,
      );
      return 1;
    }
    p.log.step(`Fetching it with ${cmd(`npx yurei-chrome@${latest} update`)}`);
    const run = spawnSync(npx, ["--yes", `yurei-chrome@${latest}`, "update"], { stdio: "inherit", shell: isWindows });
    return run.status ?? 1;
  }
  s.stop(`v${VERSION} is the newest version`);
  const install = spinner();
  install.start("Putting it in place");
  const report = installNativeHost();
  installSkill();
  install.stop(`Installed for ${report.browsers.join(", ")}, skill refreshed`);
  const client = new HostClient({ harness: () => "yurei update", log: () => undefined });
  const connected = await client.waitForExtension(3000);
  const fresh = connected ? await refreshHost(client) : false;
  client.close();
  if (!connected)
    p.log.info("The extension is not connected right now; it picks up the new version when it next connects.");
  p.outro(
    fresh || !connected
      ? `${bold("boo.")} Yurei v${VERSION} is in.`
      : shu("Yurei is installed, but the old native host is still running."),
  );
  return 0;
}
