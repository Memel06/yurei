import * as p from "@clack/prompts";
import pc from "picocolors";
import { VERSION } from "./mcp";

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const truecolor = /^(truecolor|24bit)$/i.test(process.env["COLORTERM"] ?? "");
const rgb = (r: number, g: number, b: number, fallback: (s: string) => string) => (s: string): string => {
  if (!pc.isColorSupported) return s;
  return truecolor ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m` : fallback(s);
};

/** yurei.web.app's palette: glow for the kanji and anything worth a look, shu red for stop and failure, blue for the ghost. */
export const glow = rgb(138, 211, 252, pc.cyan);
export const shu = rgb(199, 58, 39, pc.red);
const blue = rgb(66, 116, 242, pc.blue);
export const dim = pc.dim;
export const bold = pc.bold;

/** A command for the user to type, with the site's glow prompt in front. */
export const cmd = (line: string): string => `${glow("$")} ${bold(line)}`;

/** Section labels the way the site sets its kickers: small, spaced, quiet. */
export const kicker = (label: string): string => dim(label.toUpperCase().split("").join(" "));

const TAGLINE = "Your AI, haunting your browser.";

// Block glyphs and kanji need a UTF-8 console; on Windows only the modern terminals announce one.
export const unicode = process.platform !== "win32" || Boolean(process.env["WT_SESSION"] || process.env["TERM_PROGRAM"]);

/** Brush numerals, as the site numbers its steps. */
const NUMERALS = ["一", "二", "三", "四", "五"];
export const numeral = (n: number): string => shu(unicode ? (NUMERALS[n - 1] ?? String(n)) : String(n));

const GHOST = [
  "      ▄▄████▄▄",
  "    ▄██▀      ▀██▄",
  "   ███   ●  ●   ███",
  "    ▀██▄      ▄██▀",
  "   ▄▄▄▀▀▀▀▀▀▀██▀",
];

const eyes = (row: string): string => row.replace(/●  ●/, (m) => pc.reset(bold(m)));

/** The brand row from the site, with the ghost alongside when the console can draw it. */
export function banner(): string {
  const name = `${glow(unicode ? "幽霊  " : "")}${bold("yurei")}  ${dim(`v${VERSION}`)}`;
  if (!unicode) return `\n  ${name}\n  ${dim(TAGLINE)}\n`;
  const side = ["", name, dim(TAGLINE), "", ""];
  return `\n${GHOST.map((row, i) => `  ${eyes(blue(row))}${" ".repeat(24 - row.length)}${side[i] ?? ""}`.trimEnd()).join("\n")}\n`;
}

export type Spinner = ReturnType<typeof p.spinner>;

/** A clack spinner on a terminal; plain start/stop lines when output is piped, where cursor movement would be garbage. */
export function spinner(): Spinner {
  if (process.stdout.isTTY) return p.spinner();
  return {
    start: (msg = "") => p.log.step(msg),
    stop: (msg = "", code = 0) => (code === 0 ? p.log.success(msg) : p.log.error(msg)),
    message: () => undefined,
  };
}

/** Cuts a line to the terminal width, so boxes drawn around it never wrap. */
export function clip(line: string, reserve = 8): string {
  const width = (process.stdout.columns ?? 100) - reserve;
  return line.length > width ? `${line.slice(0, width - 1)}…` : line;
}
