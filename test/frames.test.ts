import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composeFind,
  composeText,
  composeTree,
  type FrameInfo,
  type FrameMap,
  type FrameResult,
  frameOfRef,
  localRef,
  qualifyText,
} from "../yurei-extension/src/frames";
import type { FrameSlot } from "../yurei-extension/src/page-api";

test("refs carry their frame", () => {
  assert.equal(frameOfRef("ref_7"), 0);
  assert.equal(frameOfRef("frame12_ref_3"), 12);
  assert.equal(frameOfRef(" frame2_ref_1 "), 2);
  assert.equal(localRef("frame12_ref_3"), "ref_3");
  assert.equal(localRef("ref_3"), "ref_3");
  assert.equal(localRef("weird"), "weird");
  assert.equal(qualifyText("button [ref_1]\nlink [ref_22]", 4), "button [frame4_ref_1]\nlink [frame4_ref_22]");
  assert.equal(qualifyText("button [ref_1]", 0), "button [ref_1]");
});

const slot: FrameSlot = {
  ref: "ref_2",
  depth: 0,
  label: '"chat"',
  box: { x: 10, y: 20, width: 300, height: 200 },
  src: "https://chat.example/",
  name: "",
};
const map: FrameMap = {
  byId: new Map<number, FrameInfo>([
    [0, { frameId: 0, parentFrameId: -1, slot: null, viewport: { width: 1000, height: 800 }, error: null }],
    [5, { frameId: 5, parentFrameId: 0, slot, viewport: { width: 300, height: 200 }, error: null }],
  ]),
  childOfSlot: new Map([["0:ref_2", 5]]),
};
const top: FrameResult = {
  frameId: 0,
  slot: null,
  data: { text: 'button "Go" [ref_1]\niframe "chat" [ref_2]\nlink "More" [ref_3]', frames: [slot] },
  error: null,
};
const child = (text: string): FrameResult => ({ frameId: 5, slot, data: { text, frames: [] }, error: null });

test("composeTree splices an iframe's outline under its line with qualified refs", () => {
  assert.equal(
    composeTree({ map, results: [top, child('textbox "Message" [ref_1]')] }, "interactive"),
    'button "Go" [ref_1]\niframe "chat" [ref_2]\n textbox "Message" [frame5_ref_1]\nlink "More" [ref_3]',
  );
});

test("an iframe with nothing to list disappears from the interactive outline but stays in the full one", () => {
  assert.equal(
    composeTree({ map, results: [top, child("")] }, "interactive"),
    'button "Go" [ref_1]\nlink "More" [ref_3]',
  );
  assert.equal(
    composeTree({ map, results: [top, child("")] }, "all"),
    'button "Go" [ref_1]\niframe "chat" [ref_2]\nlink "More" [ref_3]',
  );
});

test("an iframe that could not be read says so on its line", () => {
  assert.equal(
    composeTree({ map, results: [top] }, "interactive"),
    'button "Go" [ref_1]\niframe "chat" [ref_2] (contents not accessible: frame is not scriptable; click inside it by coordinate)\nlink "More" [ref_3]',
  );
});

test("composeFind ranks hits across frames and names the iframe", () => {
  const results: FrameResult[] = [
    {
      ...top,
      data: { hits: [{ ref: "ref_1", role: "button", name: "Search", href: null, inView: true, score: 15 }], total: 1 },
    },
    {
      ...child(""),
      data: {
        hits: [{ ref: "ref_1", role: "link", name: "Search help", href: "/help", inView: false, score: 20 }],
        total: 1,
      },
    },
  ];
  assert.equal(
    composeFind({ map, results }, "search"),
    '2 matches:\nlink "Search help" [frame5_ref_1] (needs scrolling) href="/help" (inside iframe "chat")\nbutton "Search" [ref_1] (visible)',
  );
  assert.equal(
    composeFind({ map, results: [{ ...top, data: { hits: [], total: 0 } }] }, "x"),
    'No elements match "x". Try different words, or use read_page to list the page.',
  );
});

test("composeText follows document order and heads each iframe's text", () => {
  const results = [{ ...top, data: { text: "Hello" } }, child("Inner")];
  assert.equal(composeText({ map, results }, 1000), 'Hello\n\n--- iframe "chat" ---\nInner');
  const cut = composeText({ map, results }, 10);
  assert.ok(cut.startsWith("Hello\n"));
  assert.ok(cut.includes("[truncated at 10 of"));
});
