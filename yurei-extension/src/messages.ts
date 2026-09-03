import { isRecord, type Session } from "../../shared/protocol";

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
};

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
