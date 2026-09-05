import { isRecord, type Session, UPDATE_COMMAND } from "../../shared/protocol";
import { isNewer } from "../../shared/semver";

export type IndicatorMessage =
  | { readonly type: "yurei:show"; readonly color: string }
  | { readonly type: "yurei:hide" }
  | { readonly type: "yurei:cursor"; readonly x: number; readonly y: number }
  | { readonly type: "yurei:hide-for-capture" }
  | { readonly type: "yurei:show-after-capture" };

export type StatusResponse = {
  readonly version: string;
  readonly accent: string;
  readonly connected: boolean;
  readonly error: string | null;
  readonly sessions: ReadonlyArray<Session>;
  /** Version of the command line tool Chrome is running as native host; "" before 0.3 or when not connected. */
  readonly hostVersion: string;
  /** False when the host speaks another protocol version, so tool calls are refused until one side is updated. */
  readonly compatible: boolean;
  /** A newer command line tool on npm, when the host's daily check found one. */
  readonly latest: string | null;
};

export type UpdateHint = { readonly text: string; readonly command: string | null };

/** What the user should do, if anything, to get the extension and the command line tool back in step. */
export function updateHint(status: StatusResponse): UpdateHint | null {
  if (status.connected && !status.compatible) {
    return isNewer(status.version, status.hostVersion)
      ? {
          text: `The command line tool (v${status.hostVersion}) is older than this extension (v${status.version}). Update it with `,
          command: UPDATE_COMMAND,
        }
      : {
          text: `This extension (v${status.version}) is older than the command line tool (v${status.hostVersion}). Chrome updates it within a few hours; reloading it in chrome://extensions may do it now.`,
          command: null,
        };
  }
  if (status.latest !== null && status.hostVersion && isNewer(status.latest, status.hostVersion)) {
    return { text: `Yurei v${status.latest} is out. Update with `, command: UPDATE_COMMAND };
  }
  return null;
}

export type RuntimeMessage =
  | { readonly type: "yurei:stop" }
  | { readonly type: "yurei:stop-all" }
  | { readonly type: "yurei:status" }
  | { readonly type: "yurei:reconnect" }
  | { readonly type: "yurei:set-accent"; readonly color: string };

export const DEFAULT_ACCENT = "#4274f2";

export const isRuntimeMessage = (v: unknown): v is RuntimeMessage => {
  if (!isRecord(v)) return false;
  switch (v["type"]) {
    case "yurei:stop":
    case "yurei:stop-all":
    case "yurei:status":
    case "yurei:reconnect":
      return true;
    case "yurei:set-accent":
      return typeof v["color"] === "string";
    default:
      return false;
  }
};

export const isIndicatorMessage = (v: unknown): v is IndicatorMessage => {
  if (!isRecord(v)) return false;
  switch (v["type"]) {
    case "yurei:hide":
    case "yurei:hide-for-capture":
    case "yurei:show-after-capture":
      return true;
    case "yurei:show":
      return typeof v["color"] === "string";
    case "yurei:cursor":
      return typeof v["x"] === "number" && typeof v["y"] === "number";
    default:
      return false;
  }
};
