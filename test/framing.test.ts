import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFrame, FrameParser } from "../yurei-kit/src/framing";

test("frames survive being split across chunks and glued together", () => {
  const parser = new FrameParser();
  const a = encodeFrame({ type: "ping" });
  const b = encodeFrame({ type: "hello", harness: "x" });
  const stream = Buffer.concat([a, b]);
  assert.deepEqual(parser.push(stream.subarray(0, 3)), []);
  assert.deepEqual(parser.push(stream.subarray(3, a.length + 2)), [{ type: "ping" }]);
  assert.deepEqual(parser.push(stream.subarray(a.length + 2)), [{ type: "hello", harness: "x" }]);
  assert.deepEqual(parser.push(Buffer.alloc(0)), []);
});

test("the length prefix is little-endian and counts UTF-8 bytes", () => {
  const frame = encodeFrame({ t: "幽霊" });
  assert.equal(frame.readUInt32LE(0), Buffer.byteLength(JSON.stringify({ t: "幽霊" })));
  assert.equal(frame.length, 4 + frame.readUInt32LE(0));
});

test("a corrupt frame is dropped and the following one still parses", () => {
  const body = Buffer.from("{not json", "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  assert.deepEqual(new FrameParser().push(Buffer.concat([header, body, encodeFrame({ ok: true })])), [{ ok: true }]);
});
