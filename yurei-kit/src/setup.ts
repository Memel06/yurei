import { createInterface, type Interface } from "node:readline/promises";
import { dirname } from "node:path";
import { CHROME_WEB_STORE_URL } from "../../shared/protocol";
import { detectHarnesses, HARNESSES, installSkill, type Harness } from "./harness";
import { HostClient } from "./host-client";
import { installNativeHost, type InstallReport } from "./install";
import { VERSION } from "./mcp";
import { extensionDir, isWindows } from "./paths";

const EXTENSION_WAIT_MS = 90_000;

export type SetupOptions = { readonly assumeYes: boolean };

const say = (line = ""): void => console.log(line);
const interactive = (): boolean => process.stdin.isTTY === true;

// One interface for the whole wizard: closing and reopening one per question drops buffered input.
let prompt: Interface | null = null;
let stdinDone = false;

async function ask(question: string, fallback: string): Promise<string> {
  if (!interactive() || stdinDone) return fallback;
  prompt ??= createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(question);
    return answer.trim() || fallback;
  } catch {
    // End of input (Ctrl-D or a closed pipe): behave like a non-interactive run from here on.
    stdinDone = true;
    say(`(no answer, using ${fallback})`);
    return fallback;
  }
}

const closePrompt = (): void => {
  prompt?.close();
  prompt = null;
};

function nativeHostStep(): InstallReport {
  say("1/3  Native host");
  const report = installNativeHost();
  say(`     ✔ ${report.launcher} registered for ${report.browsers.join(", ")}`);
  if (report.warning) say(`     ! ${report.warning}`);
  return report;
}

function extensionInstructions(): void {
  const dir = extensionDir();
  if (dir === null) {
    say("     Not connected yet. Add Yurei to Chrome from the Chrome Web Store:");
    say(`       ${CHROME_WEB_STORE_URL}`);
    return;
  }
  say("     Not connected yet. In Chrome:");
  say("       1. open   chrome://extensions");
  say("       2. enable Developer mode (top right)");
  say("       3. click  Load unpacked and choose this folder:");
  say(`          ${dir}`);
}

/** Waits for the extension, showing how to install it and letting the user retry. */
async function extensionStep(client: HostClient, assumeYes: boolean): Promise<boolean> {
  say();
  say("2/3  Chrome extension");
  if (await client.waitForExtension(2000)) {
    say(`     ✔ Yurei v${client.extensionVersion} is connected`);
    return true;
  }
  extensionInstructions();
  for (;;) {
    say(`     Waiting up to ${EXTENSION_WAIT_MS / 1000}s…`);
    if (await client.waitForExtension(EXTENSION_WAIT_MS)) {
      say(`     ✔ Yurei v${client.extensionVersion} is connected`);
      return true;
    }
    if (assumeYes || !interactive()) {
      say("     ✖ still not connected.");
      return false;
    }
    if (!/^r/i.test(await ask("     Not connected. [r]etry or [s]kip? [r] ", "r"))) return false;
  }
}

async function verifyStep(client: HostClient): Promise<boolean> {
  const result = await client.call("tabs_context", {});
  const first = result.content[0];
  const summary = first?.type === "text" ? (first.text.split("\n")[0] ?? "") : "";
  say(result.isError ? `     ✖ the extension answered with an error: ${summary}` : `     ✔ ${summary}`);
  return !result.isError;
}

async function pickHarnesses(found: ReadonlyArray<Harness>, assumeYes: boolean): Promise<ReadonlyArray<Harness>> {
  if (assumeYes || !interactive()) return found;
  const answer = (await ask('     Add Yurei to which? [all] (numbers like "1 3", or n for none): ', "all")).toLowerCase();
  if (/^(all|a|y|yes)$/.test(answer)) return found;
  if (/^(n|no|none)$/.test(answer)) return [];
  const numbers = answer.split(/[\s,]+/).map(Number);
  return found.filter((_, index) => numbers.includes(index + 1));
}

const configure = (harness: Harness): string => {
  if (!harness.configure) throw new Error("no automatic config for this tool");
  return harness.configure();
};

async function harnessStep(assumeYes: boolean): Promise<number> {
  say();
  say("3/3  AI tools");
  const found = detectHarnesses();
  const missing = HARNESSES.filter((h) => h.id !== "generic" && !found.includes(h));
  if (found.length === 0) {
    say("     None found. Print the config for yours with: yurei config <tool>");
    return 0;
  }
  say(`     Found: ${found.map((h, index) => `${index + 1}) ${h.name}`).join("   ")}`);
  const chosen = await pickHarnesses(found, assumeYes);
  if (chosen.length === 0) {
    say("     Skipped. `yurei config <tool>` prints the config for any of them.");
    return 0;
  }
  let configured = 0;
  for (const harness of chosen) {
    const label = harness.name.padEnd(12);
    try {
      say(`     ✔ ${label} ${configure(harness)}`);
      configured++;
    } catch (e) {
      say(`     ✖ ${label} ${e instanceof Error ? e.message : String(e)}`);
      say(`                  run: yurei config ${harness.id}`);
    }
  }
  if (configured > 0) say(`     ✔ ${"skill".padEnd(12)} ${installSkill()} (tells the AI when to use the browser)`);
  if (missing.length > 0) say(`     Not found: ${missing.map((h) => h.name).join(", ")} (yurei config <tool> prints their config)`);
  return configured;
}

const onPath = (dir: string): boolean => (process.env["PATH"] ?? "").split(isWindows ? ";" : ":").includes(dir);

function commandHint(report: InstallReport): void {
  const dir = dirname(report.command ?? report.launcher);
  if (report.command !== null && onPath(dir)) {
    say("Check the installation any time with: yurei doctor");
    return;
  }
  say(`Check the installation any time with: ${report.command ?? `"${report.launcher}"`} doctor`);
  say(`  yurei is not on your PATH: add ${dir} to it, or run every command as npx yurei-chrome <command>`);
}

/** One command from nothing to a working setup: native host, extension, and the AI tools the user picks. */
export async function runSetup(options: SetupOptions): Promise<number> {
  say(`Yurei v${VERSION} setup`);
  say();
  const report = nativeHostStep();

  const client = new HostClient({ harness: () => "yurei setup", log: () => undefined });
  const connected = await extensionStep(client, options.assumeYes);
  const works = connected ? await verifyStep(client) : false;
  client.close();

  const configured = await harnessStep(options.assumeYes);
  closePrompt();
  say();
  if (works) {
    say(configured > 0 ? "Done. Restart your AI tool, then ask it:" : "Done. Once your AI tool has the config, ask it:");
    say('  "open example.com and tell me the page title"');
    commandHint(report);
    return 0;
  }
  say("Chrome cannot be driven yet: the extension is not connected.");
  extensionInstructions();
  commandHint(report);
  return 1;
}
