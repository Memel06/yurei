import * as p from "@clack/prompts";
import { dirname } from "node:path";
import { CHROME_WEB_STORE_URL } from "../../shared/protocol";
import { detectHarnesses, HARNESSES, installSkill, type Harness } from "./harness";
import { HostClient } from "./host-client";
import { installNativeHost, type InstallReport } from "./install";
import { extensionDir, isWindows } from "./paths";
import { banner, bold, cmd, dim, errorMessage, glow, numeral, shu, spinner } from "./ui";

const EXTENSION_WAIT_MS = 90_000;
const ASK = '"open example.com and tell me the page title"';

export type SetupOptions = { readonly assumeYes: boolean };

const interactive = (): boolean => process.stdin.isTTY === true;
const step = (n: number, title: string): void => p.log.message(bold(title), { symbol: numeral(n) });

function nativeHostStep(): InstallReport {
  step(1, "Native host");
  const s = spinner();
  s.start("Registering the native host with your browsers");
  const report = installNativeHost();
  s.stop(`Registered for ${report.browsers.join(", ")}`);
  if (report.warning) p.log.warn(report.warning);
  return report;
}

function extensionInstructions(): void {
  const dir = extensionDir();
  if (dir === null) {
    p.note(`Add Yurei to Chrome from the Chrome Web Store:\n${glow(CHROME_WEB_STORE_URL)}`, "Chrome extension");
    return;
  }
  p.note(
    ["1. open   chrome://extensions", "2. enable Developer mode (top right)", "3. click  Load unpacked and choose this folder:", `   ${glow(dir)}`].join("\n"),
    "Load the extension",
  );
}

async function waitForExtension(client: HostClient): Promise<boolean> {
  const s = spinner();
  s.start("Waiting for the extension to say hello");
  for (let left = EXTENSION_WAIT_MS; left > 0; left -= 1000) {
    s.message(`Waiting for the extension to say hello ${dim(`${Math.ceil(left / 1000)}s`)}`);
    if (await client.waitForExtension(1000)) {
      s.stop(`Yurei v${client.extensionVersion} is connected`);
      return true;
    }
  }
  s.stop(`Nothing after ${EXTENSION_WAIT_MS / 1000}s`, 1);
  return false;
}

/** Waits for the extension, showing how to install it and letting the user keep waiting. */
async function extensionStep(client: HostClient, assumeYes: boolean): Promise<boolean> {
  step(2, "Chrome extension");
  const s = spinner();
  s.start("Looking for the Yurei extension");
  if (await client.waitForExtension(2000)) {
    s.stop(`Yurei v${client.extensionVersion} is connected`);
    return true;
  }
  s.stop("The extension is not connected yet", 1);
  extensionInstructions();
  for (;;) {
    if (await waitForExtension(client)) return true;
    if (assumeYes || !interactive()) return false;
    const again = await p.confirm({ message: "Keep waiting?", initialValue: true });
    if (again !== true) return false;
  }
}

async function verifyStep(client: HostClient): Promise<boolean> {
  const s = spinner();
  s.start("Asking Chrome for its tabs");
  const result = await client.call("tabs_context", {});
  const first = result.content[0];
  const text = first?.type === "text" ? first.text : "";
  if (result.isError) {
    s.stop(`The extension answered with an error: ${text.split("\n")[0] ?? ""}`, 2);
    return false;
  }
  const tabs = /^(\d+) open tab/.exec(text)?.[1];
  s.stop(tabs === undefined ? "Chrome answers" : `Chrome answers: ${tabs} open ${tabs === "1" ? "tab" : "tabs"}`);
  return true;
}

/** Null when the user backed out of the menu. */
async function pickHarnesses(found: ReadonlyArray<Harness>, assumeYes: boolean): Promise<ReadonlyArray<Harness> | null> {
  if (assumeYes || !interactive()) return found;
  const picked = await p.multiselect({
    message: "Add Yurei to which AI tools?",
    options: found.map((h) => ({ value: h.id, label: h.name, hint: h.hint })),
    initialValues: found.map((h) => h.id),
    required: false,
  });
  if (p.isCancel(picked)) return null;
  return found.filter((h) => picked.includes(h.id));
}

async function configureHarness(harness: Harness): Promise<boolean> {
  if (!harness.configure) return false;
  const s = spinner();
  s.start(`Adding Yurei to ${harness.name}`);
  try {
    const where = await harness.configure((message) => s.message(`${harness.name}: ${message}`));
    s.stop(`${harness.name} ${dim(where)}`);
    return true;
  } catch (e) {
    s.stop(`${harness.name}: ${errorMessage(e)}`, 2);
    p.log.message(`The config to paste by hand: ${cmd(`yurei config ${harness.id}`)}`);
    return false;
  }
}

/** Null when the user backed out, otherwise how many tools now point at Yurei. */
async function harnessStep(assumeYes: boolean): Promise<number | null> {
  step(3, "AI tools");
  const found = detectHarnesses();
  const missing = HARNESSES.filter((h) => h.configure !== null && !found.includes(h));
  if (found.length === 0) {
    p.log.warn(`No AI tool found. Print the config for yours with ${cmd("yurei config <tool>")}`);
    return 0;
  }
  const chosen = await pickHarnesses(found, assumeYes);
  if (chosen === null) return null;
  if (chosen.length === 0) {
    p.log.info(`Skipped. ${cmd("yurei config <tool>")} prints the config for any of them.`);
    return 0;
  }
  let configured = 0;
  for (const harness of chosen) if (await configureHarness(harness)) configured++;
  if (configured > 0) p.log.success(`Skill ${dim(installSkill())} ${dim("tells the AI when to reach for the browser")}`);
  if (missing.length > 0) p.log.info(`Not found: ${missing.map((h) => h.name).join(", ")}. ${dim("yurei config <tool> prints their config.")}`);
  return configured;
}

const onPath = (dir: string): boolean => (process.env["PATH"] ?? "").split(isWindows ? ";" : ":").includes(dir);

function commandHint(report: InstallReport): void {
  const dir = dirname(report.command ?? report.launcher);
  if (report.command !== null && onPath(dir)) {
    p.log.info(`Check the installation any time with ${cmd("yurei doctor")}`);
    return;
  }
  p.log.info(`yurei is not on your PATH. Add ${bold(dir)} to it, or run every command as ${cmd("npx yurei-chrome <command>")}`);
  p.log.info(`Check the installation any time with ${cmd(`${report.command ?? `"${report.launcher}"`} doctor`)}`);
}

/** One command from nothing to a working setup: native host, extension, and the AI tools the user picks. */
export async function runSetup(options: SetupOptions): Promise<number> {
  console.log(banner());
  p.intro(`${bold("summon")} ${dim("three steps, a minute or two")}`);
  process.once("SIGINT", () => {
    p.cancel("Setup stopped. Run it again any time.");
    process.exit(130);
  });

  const report = nativeHostStep();
  const client = new HostClient({ harness: () => "yurei setup", log: () => undefined });
  const connected = await extensionStep(client, options.assumeYes);
  const works = connected ? await verifyStep(client) : false;
  client.close();

  const configured = await harnessStep(options.assumeYes);
  if (configured === null) {
    p.cancel("Setup stopped. Run it again any time.");
    return 1;
  }
  commandHint(report);
  if (works) {
    p.outro(`${bold("boo.")} ${configured > 0 ? "Restart your AI tool, then ask it:" : "Once your AI tool has the config, ask it:"} ${glow(ASK)}`);
    return 0;
  }
  extensionInstructions();
  p.outro(shu("Chrome cannot be driven yet: the extension is not connected."));
  return 1;
}
