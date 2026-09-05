import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CHROME_WEB_STORE_URL, isToolName, type ToolResult, UPDATE_COMMAND } from "../../shared/protocol";
import { isNewer } from "../../shared/semver";
import { HARNESS_IDS, harnessById, installSkill, isHarnessId } from "./harness";
import { HostClient, NOT_CONNECTED_HELP } from "./host-client";
import { installedManifests, installLauncher } from "./install";
import { createMcpServer } from "./mcp";
import { runNativeHost } from "./native-host";
import { extensionDir, isWindows, launcherPath } from "./paths";
import { runSetup } from "./setup";
import { banner, bold, clip, cmd, dim, errorMessage, glow, shu, spinner } from "./ui";
import { latestVersion, runUpdate } from "./update";
import { VERSION } from "./version";

type Cli = {
  readonly command: string;
  readonly positional: ReadonlyArray<string>;
  readonly flags: ReadonlySet<string>;
};

const log = (message: string): void => {
  process.stderr.write(`[yurei] ${message}\n`);
};

const fail = (message: string): never => {
  process.stderr.write(`${shu("✖")} ${message}\n`);
  process.exit(1);
};

function parseCli(argv: ReadonlyArray<string>): Cli {
  const positional: string[] = [];
  const flags = new Set<string>();
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg.slice(2));
    else positional.push(arg);
  }
  const first = positional[0] ?? "";
  // Chrome starts the native host through the launcher with the extension origin as the first argument.
  const command = first.startsWith("chrome-extension://") ? "native-host" : first;
  return { command, positional: positional.slice(1), flags };
}

async function serve(): Promise<void> {
  let harnessName = "unknown AI tool";
  const client = new HostClient({ harness: () => harnessName, log });
  client
    .connect()
    .catch((e: unknown) => log(`native host lookup failed: ${e instanceof Error ? e.message : String(e)}`));
  log(`v${VERSION}`);
  const server = createMcpServer(client);
  server.server.oninitialized = () => {
    harnessName = server.server.getClientVersion()?.name ?? harnessName;
    log(`serving ${harnessName}`);
    client.announce();
  };
  const shutdown = (): void => {
    client.close();
    process.exit(0);
  };
  server.server.onclose = shutdown;
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await server.connect(new StdioServerTransport());
}

const printResult = (result: ToolResult): void => {
  for (const block of result.content) {
    if (block.type === "text") console.log(block.text);
    else console.log(`[image ${Math.round((block.data.length * 0.75) / 1024)} KB]`);
  }
};

/** Quiet mode keeps stdout clean for `call`, whose output is meant to be piped. */
async function withExtension(
  harness: string,
  run: (client: HostClient) => Promise<number>,
  quiet = false,
): Promise<never> {
  const client = new HostClient({ harness: () => harness, log: () => undefined });
  const s = quiet ? null : spinner();
  s?.start("Looking for the Yurei extension");
  if (!(await client.waitForExtension(15_000))) {
    const why = client.connected ? "Native host found, but the extension has not said hello" : "No native host running";
    if (s) {
      s.stop(why, 2);
      p.log.message(NOT_CONNECTED_HELP);
    } else process.stderr.write(`${shu("✖")} ${why}\n${NOT_CONNECTED_HELP}\n`);
    client.close();
    process.exit(1);
  }
  s?.stop(`Extension v${client.extensionVersion} connected`);
  const code = await run(client);
  client.close();
  process.exit(code);
}

/** Runs the installed launcher end to end (node found, CLI copy intact) and returns the version it reports. */
function launcherVersion(): string | null {
  const launcher = launcherPath();
  const run = isWindows
    ? spawnSync("cmd.exe", ["/c", launcher, "version"], { encoding: "utf8" })
    : spawnSync(launcher, ["version"], { encoding: "utf8" });
  const out = (run.stdout ?? "").trim();
  return run.status === 0 && /^\d+\.\d+\.\d+/.test(out) ? out : null;
}

async function doctor(): Promise<never> {
  p.intro(`${bold("yurei doctor")} ${dim(`v${VERSION}`)}`);
  const manifests = installedManifests();
  if (manifests.length === 0) p.log.error(`Native host not registered with any browser. Run ${cmd("yurei setup")}`);
  else p.log.success(`Native host registered for ${manifests.map((m) => m.browser).join(", ")}`);
  const version = launcherVersion();
  if (version) p.log.success(`Launcher ${dim(launcherPath())} runs v${version}`);
  else p.log.error(`Launcher ${dim(launcherPath())} is missing or broken. Run ${cmd("yurei setup")}`);
  const dir = extensionDir();
  p.log.info(dir ? `Extension to load unpacked: ${dim(dir)}` : `Extension: ${glow(CHROME_WEB_STORE_URL)}`);
  const latest = await latestVersion();
  if (latest !== null && isNewer(latest, VERSION))
    p.log.warn(`Yurei v${latest} is out and this is v${VERSION}. Update with ${cmd(UPDATE_COMMAND)}`);
  else p.log.success(`Command line tool v${VERSION}${latest === null ? "" : ", the newest version"}`);
  return withExtension("yurei doctor", async (client) => {
    if (client.hostVersion !== VERSION) {
      const running = client.hostVersion ? `v${client.hostVersion}` : "older than 0.3";
      p.log.warn(
        `The native host Chrome is running is ${running}, not v${VERSION}. Run ${cmd(UPDATE_COMMAND)}, or reload the extension in chrome://extensions.`,
      );
    }
    const result = await client.call("tabs_context", {});
    const [first = "", ...tabs] = result.content.flatMap((b) => (b.type === "text" ? b.text.split("\n") : []));
    if (result.isError) {
      p.log.error(`tabs_context failed: ${first}`);
      p.outro(shu("Chrome did not answer."));
      return 1;
    }
    p.note(tabs.map((line) => clip(line)).join("\n"), first.split(";")[0]);
    p.outro(`All good. Add Yurei to your AI tools with ${cmd("yurei setup")}`);
    return 0;
  });
}

const call = (positional: ReadonlyArray<string>): Promise<never> => {
  const [tool, rawArgs = "{}"] = positional;
  if (!tool || !isToolName(tool)) return Promise.resolve(fail(`usage: yurei call <tool> '<json args>'`));
  const parsed: unknown = JSON.parse(rawArgs);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return Promise.resolve(fail("args must be a JSON object"));
  const args: Record<string, unknown> = { ...parsed };
  return withExtension(
    "yurei call",
    async (client) => {
      const result = await client.call(tool, args);
      printResult(result);
      return result.isError ? 1 : 0;
    },
    true,
  );
};

const reloadExtension = (): Promise<never> =>
  withExtension("yurei reload", async (client) => {
    if (!(await client.reload())) return 1;
    p.outro("Asked the extension to reload itself from disk. It reconnects within a few seconds.");
    return 0;
  });

const COMMANDS: ReadonlyArray<readonly [usage: string, what: string]> = [
  ["setup [--yes]", "install everything: native host, extension check, the AI tools you pick"],
  ["update", "get the newest command line tool and skill (Chrome updates the extension by itself)"],
  ["doctor", "check the installation and list your tabs through the extension"],
  ["config <tool>", `print the MCP config for one AI tool: ${HARNESS_IDS.join(", ")}`],
  ["call <tool> '<json>'", `run one browser tool by hand, e.g. yurei call navigate '{"url":"example.com"}'`],
  ["serve", "MCP server over stdio (this is what your AI tool launches)"],
  ["reload-extension", "development: reload the unpacked extension after a rebuild"],
  ["native-host", "(launched by Chrome, not by you)"],
];

function help(): string {
  const width = Math.max(...COMMANDS.map(([usage]) => usage.length));
  return [
    banner(),
    ...COMMANDS.map(([usage, what]) => `  ${glow("$")} yurei ${bold(usage.padEnd(width))}  ${dim(what)}`),
    "",
    `  ${dim("New here?")} ${cmd("npx yurei-chrome setup")}`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.flags.has("version") || cli.command === "version" || cli.command === "-v") {
    console.log(VERSION);
    return;
  }
  if (cli.flags.has("help") || cli.command === "help" || cli.command === "-h" || cli.command === "") {
    console.log(help());
    return;
  }
  switch (cli.command) {
    case "setup":
      return process.exit(await runSetup({ assumeYes: cli.flags.has("yes") }));
    case "update":
      return process.exit(await runUpdate());
    case "serve":
      return serve();
    case "native-host":
      return runNativeHost();
    case "doctor":
      return doctor();
    case "call":
      return call(cli.positional);
    case "config": {
      const harness = cli.positional[0] ?? "";
      if (!isHarnessId(harness)) return fail(`config needs one of: ${HARNESS_IDS.join(", ")}`);
      installLauncher();
      console.log(harnessById(harness).snippet());
      console.log(
        `\n${dim("Skill installed at")} ${installSkill()} ${dim("(tells the AI when to reach for the browser)")}`,
      );
      return;
    }
    case "reload-extension":
      return reloadExtension();
    default:
      process.stderr.write(`${shu("✖")} unknown command "${cli.command}"\n${help()}\n`);
      process.exit(1);
  }
}

main().catch((e: unknown) => fail(errorMessage(e)));
