import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawnSync } from "node:child_process";
import { CHROME_WEB_STORE_URL, isToolName, type ToolResult } from "../../shared/protocol";
import { harnessById, HARNESS_IDS, installSkill, isHarnessId } from "./harness";
import { HostClient, NOT_CONNECTED_HELP } from "./host-client";
import { installLauncher, installedManifests } from "./install";
import { createMcpServer, VERSION } from "./mcp";
import { runNativeHost } from "./native-host";
import { extensionDir, isWindows, launcherPath } from "./paths";
import { runSetup } from "./setup";

type Cli = {
  readonly command: string;
  readonly positional: ReadonlyArray<string>;
  readonly flags: ReadonlySet<string>;
};

const log = (message: string): void => {
  process.stderr.write(`[yurei] ${message}\n`);
};

const fail = (message: string): never => {
  process.stderr.write(`yurei: ${message}\n`);
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
  client.connect().catch((e: unknown) => log(`native host lookup failed: ${e instanceof Error ? e.message : String(e)}`));
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

async function withExtension(harness: string, run: (client: HostClient) => Promise<number>): Promise<never> {
  const client = new HostClient({ harness: () => harness, log: () => undefined });
  console.log("… looking for the Yurei extension (up to 15s)");
  if (!(await client.waitForExtension(15_000))) {
    console.log(`✖ ${client.connected ? "native host found but the extension has not said hello" : "no native host running"}.\n${NOT_CONNECTED_HELP}`);
    client.close();
    process.exit(1);
  }
  console.log(`✔ extension v${client.extensionVersion} connected`);
  const code = await run(client);
  client.close();
  process.exit(code);
}

/** Runs the installed launcher end to end (node found, CLI copy intact) and returns the version it reports. */
function launcherVersion(): string | null {
  const launcher = launcherPath();
  const run = isWindows ? spawnSync("cmd.exe", ["/c", launcher, "version"], { encoding: "utf8" }) : spawnSync(launcher, ["version"], { encoding: "utf8" });
  const out = (run.stdout ?? "").trim();
  return run.status === 0 && /^\d+\.\d+\.\d+/.test(out) ? out : null;
}

async function doctor(): Promise<never> {
  const manifests = installedManifests();
  if (manifests.length === 0) console.log("✖ native host not registered with any browser. Run: yurei setup");
  else console.log(`✔ native host registered for: ${manifests.map((m) => m.browser).join(", ")}`);
  const version = launcherVersion();
  console.log(version ? `✔ launcher ${launcherPath()} runs v${version}` : `✖ launcher ${launcherPath()} is missing or broken. Run: yurei setup`);
  const dir = extensionDir();
  console.log(dir ? `  extension to load unpacked: ${dir}` : `  extension: ${CHROME_WEB_STORE_URL}`);
  return withExtension("yurei doctor", async (client) => {
    const result = await client.call("tabs_context", {});
    console.log(result.isError ? "✖ tabs_context failed:" : "✔ tabs_context works:");
    printResult(result);
    if (!result.isError) console.log("\nAll good. Add Yurei to your AI tools with: yurei setup");
    return result.isError ? 1 : 0;
  });
}

const call = (positional: ReadonlyArray<string>): Promise<never> => {
  const [tool, rawArgs = "{}"] = positional;
  if (!tool || !isToolName(tool)) return Promise.resolve(fail(`usage: yurei call <tool> '<json args>'`));
  const parsed: unknown = JSON.parse(rawArgs);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return Promise.resolve(fail("args must be a JSON object"));
  const args: Record<string, unknown> = { ...parsed };
  return withExtension("yurei call", async (client) => {
    const result = await client.call(tool, args);
    printResult(result);
    return result.isError ? 1 : 0;
  });
};

const reloadExtension = (): Promise<never> =>
  withExtension("yurei reload", async (client) => {
    if (!(await client.reload())) return 1;
    console.log("✔ asked the extension to reload itself from disk; it reconnects within a few seconds");
    return 0;
  });

const HELP = `Yurei v${VERSION}: lets your AI tool browse in your own Chrome.

Usage:
  yurei setup [--yes]           install everything: native host, extension check, the AI tools you pick
  yurei doctor                  check the installation and list your tabs through the extension
  yurei config <tool>           print the MCP config for one AI tool: ${HARNESS_IDS.join(", ")}
  yurei call <tool> '<json>'    run one browser tool by hand, e.g. yurei call navigate '{"url":"example.com"}'
  yurei serve                   MCP server over stdio (this is what your AI tool launches)
  yurei reload-extension        development: reload the unpacked extension after a rebuild
  yurei native-host             (launched by Chrome, not by you)`;

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.flags.has("version") || cli.command === "version" || cli.command === "-v") {
    console.log(VERSION);
    return;
  }
  if (cli.flags.has("help") || cli.command === "help" || cli.command === "-h" || cli.command === "") {
    console.log(HELP);
    return;
  }
  switch (cli.command) {
    case "setup":
      process.exit(await runSetup({ assumeYes: cli.flags.has("yes") }));
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
      console.log(`\nSkill installed at ${installSkill()} (tells the AI when to use the browser).`);
      return;
    }
    case "reload-extension":
      return reloadExtension();
    default:
      process.stderr.write(`yurei: unknown command "${cli.command}"\n\n${HELP}\n`);
      process.exit(1);
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
