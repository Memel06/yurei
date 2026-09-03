export const PROTOCOL = "yurei/3";
/** Fixed by the `key` in manifest.json, so the store build and an unpacked build share it. */
export const EXTENSION_ID = "acgjkkmeekbcbpknmackieajkcmbllhm";
export const CHROME_WEB_STORE_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`;
export const NATIVE_HOST_NAME = "com.yurei.bridge";

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
  "screenshot", "left_click", "right_click", "middle_click", "double_click", "triple_click", "hover", "type", "key",
  "scroll", "scroll_to", "left_click_drag", "wait",
] as const;

export type Args = Readonly<Record<string, unknown>>;

export type TextBlock = { readonly type: "text"; readonly text: string };
export type ImageBlock = { readonly type: "image"; readonly mimeType: "image/jpeg" | "image/png"; readonly data: string };
export type ContentBlock = TextBlock | ImageBlock;
export type ToolResult = { readonly content: ReadonlyArray<ContentBlock>; readonly isError: boolean };

export const textResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: false });
export const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export type Session = { readonly harness: string };

/** Native host → extension, delivered by Chrome as JSON objects over the native messaging port. */
export type HostToExtension =
  | { readonly type: "welcome"; readonly protocol: typeof PROTOCOL; readonly sessions: ReadonlyArray<Session> }
  | { readonly type: "sessions"; readonly sessions: ReadonlyArray<Session> }
  | { readonly type: "call"; readonly id: string; readonly tool: ToolName; readonly args: Args }
  | { readonly type: "ping" }
  /** Development aid: the unpacked extension reloads itself from disk. */
  | { readonly type: "reload" };

export type ExtensionToHost =
  | { readonly type: "hello"; readonly protocol: typeof PROTOCOL; readonly extensionId: string; readonly version: string }
  | { readonly type: "result"; readonly id: string; readonly result: ToolResult }
  | { readonly type: "pong" };

/** Harness session (`yurei serve`) → native host, over the local Unix socket. */
export type SessionToHost =
  | { readonly type: "hello"; readonly protocol: typeof PROTOCOL; readonly harness: string }
  | { readonly type: "call"; readonly id: string; readonly tool: ToolName; readonly args: Args }
  | { readonly type: "reload" };

export type HostToSession =
  | { readonly type: "welcome"; readonly protocol: typeof PROTOCOL; readonly extensionConnected: boolean; readonly extensionVersion: string }
  | { readonly type: "extension"; readonly connected: boolean; readonly version: string }
  | { readonly type: "result"; readonly id: string; readonly result: ToolResult };

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

const isSession = (v: unknown): v is Session => isRecord(v) && typeof v["harness"] === "string";
const isSessionList = (v: unknown): v is ReadonlyArray<Session> => Array.isArray(v) && v.every(isSession);

const parseCall = (v: Record<string, unknown>): Extract<HostToExtension, { readonly type: "call" }> | null =>
  typeof v["id"] === "string" && isToolName(v["tool"]) && isRecord(v["args"]) ? { type: "call", id: v["id"], tool: v["tool"], args: v["args"] } : null;

export function parseHostToExtension(v: unknown): HostToExtension | null {
  if (!isRecord(v)) return null;
  switch (v["type"]) {
    case "welcome":
      return v["protocol"] === PROTOCOL && isSessionList(v["sessions"]) ? { type: "welcome", protocol: PROTOCOL, sessions: v["sessions"] } : null;
    case "sessions":
      return isSessionList(v["sessions"]) ? { type: "sessions", sessions: v["sessions"] } : null;
    case "call":
      return parseCall(v);
    case "ping":
      return { type: "ping" };
    case "reload":
      return { type: "reload" };
    default:
      return null;
  }
}

export function parseExtensionToHost(v: unknown): ExtensionToHost | null {
  if (!isRecord(v)) return null;
  switch (v["type"]) {
    case "hello":
      return v["protocol"] === PROTOCOL && typeof v["extensionId"] === "string" && typeof v["version"] === "string"
        ? { type: "hello", protocol: PROTOCOL, extensionId: v["extensionId"], version: v["version"] }
        : null;
    case "result":
      return typeof v["id"] === "string" && isToolResult(v["result"]) ? { type: "result", id: v["id"], result: v["result"] } : null;
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
      return v["protocol"] === PROTOCOL && typeof v["harness"] === "string" ? { type: "hello", protocol: PROTOCOL, harness: v["harness"] } : null;
    case "call":
      return parseCall(v);
    case "reload":
      return { type: "reload" };
    default:
      return null;
  }
}

export function parseHostToSession(v: unknown): HostToSession | null {
  if (!isRecord(v)) return null;
  switch (v["type"]) {
    case "welcome":
      return v["protocol"] === PROTOCOL && typeof v["extensionConnected"] === "boolean" && typeof v["extensionVersion"] === "string"
        ? { type: "welcome", protocol: PROTOCOL, extensionConnected: v["extensionConnected"], extensionVersion: v["extensionVersion"] }
        : null;
    case "extension":
      return typeof v["connected"] === "boolean" && typeof v["version"] === "string"
        ? { type: "extension", connected: v["connected"], version: v["version"] }
        : null;
    case "result":
      return typeof v["id"] === "string" && isToolResult(v["result"]) ? { type: "result", id: v["id"], result: v["result"] } : null;
    default:
      return null;
  }
}
