export type KeyDef = { readonly key: string; readonly code: string; readonly keyCode: number; readonly text?: string };
export type KeyPress = { readonly def: KeyDef; readonly modifiers: number; readonly commands: ReadonlyArray<string> };

export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

const fkeys: Record<string, KeyDef> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, { key: `F${i + 1}`, code: `F${i + 1}`, keyCode: 112 + i }]),
);

const NAMED: Readonly<Record<string, KeyDef>> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  del: { key: "Delete", code: "Delete", keyCode: 46 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  ...fkeys,
};

const MOD_BY_NAME: Readonly<Record<string, number>> = {
  alt: MOD.alt,
  option: MOD.alt,
  opt: MOD.alt,
  ctrl: MOD.ctrl,
  control: MOD.ctrl,
  meta: MOD.meta,
  cmd: MOD.meta,
  command: MOD.meta,
  super: MOD.meta,
  win: MOD.meta,
  shift: MOD.shift,
};

const PUNCT_CODES: Readonly<Record<string, readonly [string, number]>> = {
  "-": ["Minus", 189],
  "=": ["Equal", 187],
  "[": ["BracketLeft", 219],
  "]": ["BracketRight", 221],
  "\\": ["Backslash", 220],
  ";": ["Semicolon", 186],
  "'": ["Quote", 222],
  ",": ["Comma", 188],
  ".": ["Period", 190],
  "/": ["Slash", 191],
  "`": ["Backquote", 192],
};

function charKey(ch: string): KeyDef {
  if (ch.length !== 1) throw new Error(`Unknown key "${ch}"`);
  const upper = ch.toUpperCase();
  if (/[a-z]/i.test(ch)) return { key: ch, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: ch };
  if (/[0-9]/.test(ch)) return { key: ch, code: `Digit${ch}`, keyCode: ch.charCodeAt(0), text: ch };
  const punct = PUNCT_CODES[ch];
  if (punct) return { key: ch, code: punct[0], keyCode: punct[1], text: ch };
  return { key: ch, code: "", keyCode: 0, text: ch };
}

// Chrome on macOS only performs editing shortcuts sent over CDP when the matching editor command is named.
const MAC_EDIT_COMMANDS: Readonly<Record<string, string>> = {
  a: "selectAll",
  c: "copy",
  v: "paste",
  x: "cut",
  z: "undo",
};

function editCommands(def: KeyDef, modifiers: number): ReadonlyArray<string> {
  if (!(modifiers & MOD.meta) && !(modifiers & MOD.ctrl)) return [];
  const letter = def.key.toLowerCase();
  if (letter === "z" && modifiers & MOD.shift) return ["redo"];
  const cmd = MAC_EDIT_COMMANDS[letter];
  return cmd ? [cmd] : [];
}

/** Parses "Enter", "cmd+a", "ctrl+shift+t", "PageDown" or a single character. */
export function parseKeyPress(input: string): KeyPress {
  const trimmed = input.trim();
  if (trimmed === "+") return { def: charKey("+"), modifiers: 0, commands: [] };
  const parts = trimmed
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  let modifiers = 0;
  const rest: string[] = [];
  for (const part of parts) {
    const bit = MOD_BY_NAME[part.toLowerCase()];
    if (bit !== undefined && parts.length > 1) modifiers |= bit;
    else rest.push(part);
  }
  if (rest.length !== 1) throw new Error(`Cannot parse key "${input}". Use e.g. "Enter", "cmd+a", "ctrl+shift+t".`);
  const raw = rest[0] ?? "";
  const def = NAMED[raw.toLowerCase()] ?? charKey(raw);
  const shifted =
    modifiers & MOD.shift && /^[a-z]$/.test(def.key)
      ? { ...def, key: def.key.toUpperCase(), text: def.key.toUpperCase() }
      : def;
  return { def: shifted, modifiers, commands: editCommands(def, modifiers) };
}
