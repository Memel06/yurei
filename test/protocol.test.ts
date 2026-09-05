import assert from "node:assert/strict";
import { test } from "node:test";
import {
  errorResult,
  isToolName,
  parseExtensionToHost,
  parseHostToExtension,
  parseHostToSession,
  parseSessionToHost,
  TOOL_NAMES,
  textResult,
} from "../shared/protocol";

test("isToolName accepts exactly the tool list", () => {
  for (const name of TOOL_NAMES) assert.equal(isToolName(name), true);
  assert.equal(isToolName("rm_rf"), false);
  assert.equal(isToolName(""), false);
  assert.equal(isToolName(42), false);
});

test("textResult and errorResult wrap one text block", () => {
  assert.deepEqual(textResult("hi"), { content: [{ type: "text", text: "hi" }], isError: false });
  assert.deepEqual(errorResult("no"), { content: [{ type: "text", text: "no" }], isError: true });
});

test("parseHostToExtension keeps well-formed messages and drops the rest", () => {
  const welcome = { type: "welcome", protocol: "yurei/3", version: "0.3.0", sessions: [{ harness: "opencode" }] };
  assert.deepEqual(parseHostToExtension(welcome), welcome);
  assert.deepEqual(parseHostToExtension({ type: "welcome", protocol: "yurei/3", sessions: [] }), {
    type: "welcome",
    protocol: "yurei/3",
    version: "",
    sessions: [],
  });
  assert.equal(parseHostToExtension({ type: "welcome", protocol: "yurei/3", sessions: [{}] }), null);
  const call = { type: "call", id: "1:abc", tool: "navigate", args: { url: "example.com" } };
  assert.deepEqual(parseHostToExtension(call), call);
  assert.equal(parseHostToExtension({ type: "call", id: "1", tool: "rm_rf", args: {} }), null);
  assert.equal(parseHostToExtension({ type: "call", id: "1", tool: "navigate", args: [] }), null);
  assert.equal(parseHostToExtension({ type: "call", id: 1, tool: "navigate", args: {} }), null);
  assert.deepEqual(parseHostToExtension({ type: "ping" }), { type: "ping" });
  assert.deepEqual(parseHostToExtension({ type: "reload" }), { type: "reload" });
  assert.deepEqual(parseHostToExtension({ type: "latest", version: "0.4.0" }), { type: "latest", version: "0.4.0" });
  assert.equal(parseHostToExtension({ type: "latest" }), null);
  assert.equal(parseHostToExtension({ type: "nope" }), null);
  assert.equal(parseHostToExtension("welcome"), null);
  assert.equal(parseHostToExtension(null), null);
  assert.equal(parseHostToExtension([]), null);
});

test("parseExtensionToHost validates results block by block", () => {
  const result = {
    type: "result",
    id: "7",
    result: {
      content: [
        { type: "text", text: "hi" },
        { type: "image", mimeType: "image/jpeg", data: "AAAA" },
      ],
      isError: false,
    },
  };
  assert.deepEqual(parseExtensionToHost(result), result);
  const gif = {
    type: "result",
    id: "7",
    result: { content: [{ type: "image", mimeType: "image/gif", data: "" }], isError: false },
  };
  assert.equal(parseExtensionToHost(gif), null);
  assert.equal(parseExtensionToHost({ type: "result", id: "7", result: { content: [], isError: "no" } }), null);
  assert.equal(
    parseExtensionToHost({ type: "result", id: "7", result: { content: [{ type: "text" }], isError: false } }),
    null,
  );
  const hello = { type: "hello", protocol: "yurei/3", extensionId: "abc", version: "0.3.0" };
  assert.deepEqual(parseExtensionToHost(hello), hello);
  assert.equal(parseExtensionToHost({ type: "hello", protocol: "yurei/3" }), null);
  assert.deepEqual(parseExtensionToHost({ type: "pong" }), { type: "pong" });
});

test("parseSessionToHost", () => {
  const hello = { type: "hello", protocol: "yurei/3", harness: "yurei call" };
  assert.deepEqual(parseSessionToHost(hello), hello);
  assert.equal(parseSessionToHost({ type: "hello", protocol: "yurei/3" }), null);
  const call = { type: "call", id: "abc", tool: "tabs_context", args: {} };
  assert.deepEqual(parseSessionToHost(call), call);
  assert.deepEqual(parseSessionToHost({ type: "reload" }), { type: "reload" });
  assert.deepEqual(parseSessionToHost({ type: "restart" }), { type: "restart" });
  assert.equal(parseSessionToHost({ type: "ping" }), null);
});

test("parseHostToSession fills fields an older host leaves out", () => {
  assert.deepEqual(parseHostToSession({ type: "welcome", protocol: "yurei/3", extensionConnected: true }), {
    type: "welcome",
    protocol: "yurei/3",
    version: "",
    extensionConnected: true,
    extensionVersion: "",
    extensionProtocol: "",
    latest: null,
  });
  const full = {
    type: "welcome",
    protocol: "yurei/3",
    version: "0.3.0",
    extensionConnected: false,
    extensionVersion: "0.2.0",
    extensionProtocol: "yurei/2",
    latest: "0.4.0",
  };
  assert.deepEqual(parseHostToSession(full), full);
  assert.equal(parseHostToSession({ type: "welcome", protocol: "yurei/3" }), null);
  assert.deepEqual(parseHostToSession({ type: "extension", connected: false }), {
    type: "extension",
    connected: false,
    version: "",
    protocol: "",
  });
  assert.deepEqual(parseHostToSession({ type: "latest", version: "1.0.0" }), { type: "latest", version: "1.0.0" });
});
