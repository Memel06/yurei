export const PROTOCOL = "yurei/3";
/** Minted by the Chrome Web Store, which assigns its own id and rejects a manifest `key`. */
export const EXTENSION_ID = "fhdcknamidemigkgcfhlbdoibpfchffd";
/** Hash of the `key` in manifest.json, which is the id a folder loaded unpacked always gets. */
export const UNPACKED_EXTENSION_ID = "acgjkkmeekbcbpknmackieajkcmbllhm";
export const CHROME_WEB_STORE_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`;
export const NATIVE_HOST_NAME = "com.yurei.bridge";
/** What every update hint tells the user to type; `npx yurei-chrome update` does the same without the launcher on PATH. */
export const UPDATE_COMMAND = "yurei update";

export const TOOL_NAMES = [
  "tabs_context",
  "tabs_create",
  "tabs_close",
  "navigate",
  "computer",
  "read_page",
  "find",
  "get_page_text",
  "form_input",
  "javascript_tool",
  "read_console_messages",
  "read_network_requests",
  "resize_window",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const isToolName = (v: unknown): v is ToolName =>
  typeof v === "string" && (TOOL_NAMES as ReadonlyArray<string>).includes(v);

export const COMPUTER_ACTIONS = [
  "screenshot",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "hover",
  "type",
  "key",
  "scroll",
  "scroll_to",
  "scroll_to_bottom",
  "left_click_drag",
  "wait",
] as const;

export type Args = Readonly<Record<string, unknown>>;

export type TextBlock = { readonly type: "text"; readonly text: string };
export type ImageBlock = {
  readonly type: "image";
  readonly mimeType: "image/jpeg" | "image/png";
  readonly data: string;
};
export type ContentBlock = TextBlock | ImageBlock;
export type ToolResult = { readonly content: ReadonlyArray<ContentBlock>; readonly isError: boolean };

export const textResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: false });
export const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export type Session = { readonly harness: string };

/**
 * Both sides announce their protocol and version and accept the other's whatever it says, so a mismatch after an
 * update is reported to the user instead of being dropped on the floor. Tool calls are refused while it lasts.
 */

/** Native host → extension, delivered by Chrome as JSON objects over the native messaging port. */
export type HostToExtension =
  | {
      readonly type: "welcome";
      readonly protocol: string;
      readonly version: string;
      readonly sessions: ReadonlyArray<Session>;
    }
  | { readonly type: "sessions"; readonly sessions: ReadonlyArray<Session> }
  | { readonly type: "call"; readonly id: string; readonly tool: ToolName; readonly args: Args }
  | { readonly type: "ping" }
  /** Development aid: the unpacked extension reloads itself from disk. */
  | { readonly type: "reload" }
  /** A newer command line tool is on npm. */
  | { readonly type: "latest"; readonly version: string };

export type ExtensionToHost =
  | { readonly type: "hello"; readonly protocol: string; readonly extensionId: string; readonly version: string }
  | { readonly type: "result"; readonly id: string; readonly result: ToolResult }
  | { readonly type: "pong" };

/** Harness session (`yurei serve`) → native host, over the local Unix socket. */
export type SessionToHost =
  | { readonly type: "hello"; readonly protocol: string; readonly harness: string }
  | { readonly type: "call"; readonly id: string; readonly tool: ToolName; readonly args: Args }
  | { readonly type: "reload" }
  /** After an update: the host exits so that Chrome starts the new one. */
  | { readonly type: "restart" };

export type HostToSession =
  | {
      readonly type: "welcome";
      readonly protocol: string;
      readonly version: string;
      readonly extensionConnected: boolean;
      readonly extensionVersion: string;
      readonly extensionProtocol: string;
      readonly latest: string | null;
    }
  | { readonly type: "extension"; readonly connected: boolean; readonly version: string; readonly protocol: string }
  | { readonly type: "result"; readonly id: string; readonly result: ToolResult }
  | { readonly type: "latest"; readonly version: string };

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isContentBlock = (v: unknown): v is ContentBlock => {
  if (!isRecord(v)) return false;
  if (v["type"] === "text") return typeof v["text"] === "string";
  if (v["type"] === "image") {
    return typeof v["data"] === "string" && (v["mimeType"] === "image/jpeg" || v["mimeType"] === "image/png");
  }
  return false;
};

const isToolResult = (v: unknown): v is ToolResult =>
  isRecord(v) && Array.isArray(v["content"]) && v["content"].every(isContentBlock) && typeof v["isError"] === "boolean";

const str = (v: Record<string, unknown>, key: string): string => {
  const s = v[key];
  return typeof s === "string" ? s : "";
};

const isSession = (v: unknown): v is Session => isRecord(v) && typeof v["harness"] === "string";
const isSessionList = (v: unknown): v is ReadonlyArray<Session> => Array.isArray(v) && v.every(isSession);

const parseCall = (v: Record<string, unknown>): Extract<HostToExtension, { readonly type: "call" }> | null =>
  typeof v["id"] === "string" && isToolName(v["tool"]) && isRecord(v["args"])
    ? { type: "call", id: v["id"], tool: v["tool"], args: v["args"] }
    : null;

export function parseHostToExtension(v: unknown): HostToExtension | null {
  if (!isRecord(v)) return null;
  switch (v["type"]) {
    case "welcome":
      return typeof v["protocol"] === "string" && isSessionList(v["sessions"])
        ? { type: "welcome", protocol: v["protocol"], version: str(v, "version"), sessions: v["sessions"] }
        : null;
    case "sessions":
      return isSessionList(v["sessions"]) ? { type: "sessions", sessions: v["sessions"] } : null;
    case "call":
      return parseCall(v);
    case "ping":
      return { type: "ping" };
    case "reload":
      return { type: "reload" };
    case "latest":
      return typeof v["version"] === "string" ? { type: "latest", version: v["version"] } : null;
    default:
      return null;
  }
}

export function parseExtensionToHost(v: unknown): ExtensionToHost | null {
  if (!isRecord(v)) return null;
  switch (v["type"]) {
    case "hello":
      return typeof v["protocol"] === "string" &&
        typeof v["extensionId"] === "string" &&
        typeof v["version"] === "string"
        ? { type: "hello", protocol: v["protocol"], extensionId: v["extensionId"], version: v["version"] }
        : null;
    case "result":
      return typeof v["id"] === "string" && isToolResult(v["result"])
        ? { type: "result", id: v["id"], result: v["result"] }
        : null;
    case "pong":
      return { type: "pong" };
    default:
      return null;
  }
}

export function parseSessionToHost(v: unknown): SessionToHost | null {
  if (!isRecord(v)) return null;
  switch (v["type"]) {
    case "hello":
      return typeof v["protocol"] === "string" && typeof v["harness"] === "string"
        ? { type: "hello", protocol: v["protocol"], harness: v["harness"] }
        : null;
    case "call":
      return parseCall(v);
    case "reload":
      return { type: "reload" };
    case "restart":
      return { type: "restart" };
    default:
      return null;
  }
}

export function parseHostToSession(v: unknown): HostToSession | null {
  if (!isRecord(v)) return null;
  switch (v["type"]) {
    case "welcome":
      return typeof v["protocol"] === "string" && typeof v["extensionConnected"] === "boolean"
        ? {
            type: "welcome",
            protocol: v["protocol"],
            version: str(v, "version"),
            extensionConnected: v["extensionConnected"],
            extensionVersion: str(v, "extensionVersion"),
            extensionProtocol: str(v, "extensionProtocol"),
            latest: typeof v["latest"] === "string" ? v["latest"] : null,
          }
        : null;
    case "extension":
      return typeof v["connected"] === "boolean"
        ? { type: "extension", connected: v["connected"], version: str(v, "version"), protocol: str(v, "protocol") }
        : null;
    case "result":
      return typeof v["id"] === "string" && isToolResult(v["result"])
        ? { type: "result", id: v["id"], result: v["result"] }
        : null;
    case "latest":
      return typeof v["version"] === "string" ? { type: "latest", version: v["version"] } : null;
    default:
      return null;
  }
}
