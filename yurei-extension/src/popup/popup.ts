import type { RuntimeMessage, StatusResponse } from "../messages";

type HelpPart = string | { readonly code: string };

const SETUP_COMMAND = "npx yurei-chrome setup";
const RUN_SETUP: HelpPart[] = ["run ", { code: SETUP_COMMAND }, " in a terminal"];

const send = (message: RuntimeMessage): Promise<unknown> => chrome.runtime.sendMessage(message);

const isStatus = (v: unknown): v is StatusResponse =>
  typeof v === "object" && v !== null && Array.isArray(Reflect.get(v, "sessions")) && typeof Reflect.get(v, "connected") === "boolean";

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const dot = byId("dot");
const statusText = byId("status-text");
const list = byId("list");
const help = byId("help");
const accent = byId("accent");
const version = byId("version");
const seal = byId("stop");

let accentSynced = false;

const explain = (error: string | null): ReadonlyArray<HelpPart> => {
  if (!error) return ["Waiting for the native host…"];
  if (/not found/i.test(error)) return ["One step left: ", ...RUN_SETUP, " (needs Node.js 18 or newer). The ghost connects by itself a few seconds later."];
  if (/forbidden/i.test(error)) return ["The native host is registered for a different extension id. Run ", { code: SETUP_COMMAND }, " again, then reload this extension."];
  return [`Native host error: ${error}`];
};

const helpFor = (res: StatusResponse): ReadonlyArray<HelpPart> => {
  if (!res.connected) return explain(res.error);
  if (res.sessions.length === 0) return ["Start your AI tool. If it does not see Yurei, ", ...RUN_SETUP, " again."];
  return ["Your AI can browse in this Chrome. The glowing tab is the one it is using. Press the seal to stop everything."];
};

const renderHelp = (parts: ReadonlyArray<HelpPart>): void => {
  help.replaceChildren(
    ...parts.map((part) => {
      if (typeof part === "string") return document.createTextNode(part);
      const code = document.createElement("code");
      code.textContent = part.code;
      return code;
    }),
  );
};

async function refresh(): Promise<void> {
  const res = await send({ type: "yurei:status" }).catch(() => undefined);
  if (!isStatus(res)) return;
  version.textContent = `v${res.version}`;
  if (!accentSynced && accent instanceof HTMLInputElement) {
    accent.value = res.accent;
    accentSynced = true;
  }
  dot.classList.toggle("on", res.connected);
  const n = res.sessions.length;
  statusText.textContent = !res.connected ? "Not connected." : n === 0 ? "Connected. Nobody is haunting yet." : `Connected. ${n} session${n === 1 ? "" : "s"}.`;
  list.replaceChildren(
    ...res.sessions.map((s) => {
      const li = document.createElement("li");
      li.textContent = s.harness;
      return li;
    }),
  );
  renderHelp(helpFor(res));
}

seal.addEventListener("click", () => {
  void send({ type: "yurei:stop-all" });
  seal.classList.remove("shake");
  void seal.offsetWidth;
  seal.classList.add("shake");
});
seal.addEventListener("animationend", () => seal.classList.remove("shake"));

byId("reconnect").addEventListener("click", () => {
  void send({ type: "yurei:reconnect" }).then(() => setTimeout(() => void refresh(), 500));
});

accent.addEventListener("change", () => {
  if (accent instanceof HTMLInputElement) void send({ type: "yurei:set-accent", color: accent.value });
});

void refresh();
setInterval(() => void refresh(), 2000);
