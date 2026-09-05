import assert from "node:assert/strict";
import { test } from "node:test";
import { MOD, parseKeyPress } from "../yurei-extension/src/keys";

test("named keys, characters and function keys", () => {
  const enter = parseKeyPress("Enter");
  assert.deepEqual(enter, {
    def: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
    modifiers: 0,
    commands: [],
  });
  assert.deepEqual(parseKeyPress("return").def, enter.def);
  assert.equal(parseKeyPress("PageDown").def.code, "PageDown");
  assert.equal(parseKeyPress("esc").def.key, "Escape");
  assert.deepEqual(parseKeyPress("F5").def, { key: "F5", code: "F5", keyCode: 116 });
  assert.deepEqual(parseKeyPress("a").def, { key: "a", code: "KeyA", keyCode: 65, text: "a" });
  assert.deepEqual(parseKeyPress("7").def, { key: "7", code: "Digit7", keyCode: 55, text: "7" });
  assert.deepEqual(parseKeyPress("-").def, { key: "-", code: "Minus", keyCode: 189, text: "-" });
  assert.deepEqual(parseKeyPress("+").def, { key: "+", code: "", keyCode: 0, text: "+" });
  assert.deepEqual(parseKeyPress("é").def, { key: "é", code: "", keyCode: 0, text: "é" });
});

test("modifier chords, shifted letters and the editor commands macOS needs", () => {
  const selectAll = parseKeyPress("cmd+a");
  assert.equal(selectAll.modifiers, MOD.meta);
  assert.deepEqual(selectAll.commands, ["selectAll"]);
  assert.deepEqual(parseKeyPress("ctrl+c").commands, ["copy"]);
  assert.deepEqual(parseKeyPress("cmd+shift+z").commands, ["redo"]);
  assert.deepEqual(parseKeyPress("cmd+Enter").commands, []);
  const tab = parseKeyPress("ctrl+shift+t");
  assert.equal(tab.modifiers, MOD.ctrl | MOD.shift);
  assert.equal(tab.def.key, "T");
  assert.equal(tab.def.text, "T");
  assert.equal(parseKeyPress("option+left").modifiers, MOD.alt);
  assert.equal(parseKeyPress("win+d").modifiers, MOD.meta);
  assert.equal(parseKeyPress(" shift + Tab ").def.key, "Tab");
});

test("unparseable input fails with a hint", () => {
  assert.throws(() => parseKeyPress("ctrl+shift"), /Cannot parse key/);
  assert.throws(() => parseKeyPress("hello"), /Unknown key/);
  assert.throws(() => parseKeyPress(""), /Cannot parse key/);
});
