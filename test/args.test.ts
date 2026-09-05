import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ArgError,
  optBoolean,
  optCoordinate,
  optEnum,
  optNumber,
  optString,
  reqEnum,
  reqNumber,
  reqString,
} from "../yurei-extension/src/args";

test("strings: absent is undefined, scalars are stringified, objects are refused", () => {
  assert.equal(optString({}, "k"), undefined);
  assert.equal(optString({ k: null }, "k"), undefined);
  assert.equal(optString({ k: "v" }, "k"), "v");
  assert.equal(optString({ k: 5 }, "k"), "5");
  assert.equal(optString({ k: true }, "k"), "true");
  assert.throws(() => optString({ k: {} }, "k"), ArgError);
  assert.equal(reqString({ k: "v" }, "k"), "v");
  assert.throws(() => reqString({ k: "" }, "k"), /"k" is required/);
  assert.throws(() => reqString({}, "k"), ArgError);
});

test("numbers accept numeric strings and refuse the rest", () => {
  assert.equal(optNumber({}, "n"), undefined);
  assert.equal(optNumber({ n: 3.5 }, "n"), 3.5);
  assert.equal(optNumber({ n: "12" }, "n"), 12);
  assert.throws(() => optNumber({ n: "abc" }, "n"), /"n" must be a number/);
  assert.throws(() => optNumber({ n: "" }, "n"), ArgError);
  assert.throws(() => optNumber({ n: Number.NaN }, "n"), ArgError);
  assert.throws(() => reqNumber({}, "n"), /"n" is required/);
});

test("booleans and enums", () => {
  assert.equal(optBoolean({}, "b"), undefined);
  assert.equal(optBoolean({ b: true }, "b"), true);
  assert.equal(optBoolean({ b: "false" }, "b"), false);
  assert.throws(() => optBoolean({ b: "yes" }, "b"), /"b" must be a boolean/);
  const directions = ["up", "down"] as const;
  assert.equal(optEnum({ d: "DOWN" }, "d", directions), "down");
  assert.equal(optEnum({}, "d", directions), undefined);
  assert.throws(() => optEnum({ d: "left" }, "d", directions), /must be one of: up, down/);
  assert.throws(() => reqEnum({}, "d", directions), /"d" is required \(one of: up, down\)/);
});

test("coordinates come as a pair, an object or a string", () => {
  assert.deepEqual(optCoordinate({ c: [1, 2] }, "c"), [1, 2]);
  assert.deepEqual(optCoordinate({ c: ["10", "20"] }, "c"), [10, 20]);
  assert.deepEqual(optCoordinate({ c: { x: 1, y: 2 } }, "c"), [1, 2]);
  assert.deepEqual(optCoordinate({ c: "3, 4" }, "c"), [3, 4]);
  assert.deepEqual(optCoordinate({ c: "3 4" }, "c"), [3, 4]);
  assert.equal(optCoordinate({}, "c"), undefined);
  assert.throws(() => optCoordinate({ c: [1] }, "c"), /must be \[x, y\]/);
  assert.throws(() => optCoordinate({ c: "a,b" }, "c"), ArgError);
  assert.throws(() => optCoordinate({ c: { x: 1 } }, "c"), ArgError);
});
