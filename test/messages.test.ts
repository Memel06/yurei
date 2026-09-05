import assert from "node:assert/strict";
import { test } from "node:test";
import { UPDATE_COMMAND } from "../shared/protocol";
import { isIndicatorMessage, isRuntimeMessage, type StatusResponse, updateHint } from "../yurei-extension/src/messages";

const status = (over: Partial<StatusResponse>): StatusResponse => ({
  version: "0.3.0",
  accent: "#4274f2",
  connected: true,
  error: null,
  sessions: [],
  hostVersion: "0.3.0",
  compatible: true,
  latest: null,
  ...over,
});

test("updateHint tells the user which half to update", () => {
  assert.equal(updateHint(status({})), null);
  assert.equal(updateHint(status({ connected: false, compatible: false, hostVersion: "" })), null);
  const oldCli = updateHint(status({ compatible: false, hostVersion: "0.2.0" }));
  assert.equal(oldCli?.command, UPDATE_COMMAND);
  assert.match(oldCli?.text ?? "", /command line tool \(v0\.2\.0\) is older/);
  const oldExtension = updateHint(status({ compatible: false, hostVersion: "0.4.0" }));
  assert.equal(oldExtension?.command, null);
  assert.match(oldExtension?.text ?? "", /extension \(v0\.3\.0\) is older/);
  assert.equal(updateHint(status({ latest: "0.4.0" }))?.command, UPDATE_COMMAND);
  assert.equal(updateHint(status({ latest: "0.3.0" })), null);
  assert.equal(
    updateHint(status({ latest: "0.4.0", hostVersion: "" })),
    null,
    "an old host that never said its version",
  );
});

test("runtime and indicator messages are validated by shape", () => {
  assert.equal(isRuntimeMessage({ type: "yurei:stop" }), true);
  assert.equal(isRuntimeMessage({ type: "yurei:set-accent", color: "#000000" }), true);
  assert.equal(isRuntimeMessage({ type: "yurei:set-accent" }), false);
  assert.equal(isRuntimeMessage({ type: "yurei:show", color: "#000000" }), false);
  assert.equal(isRuntimeMessage("yurei:stop"), false);
  assert.equal(isIndicatorMessage({ type: "yurei:show", color: "#000000" }), true);
  assert.equal(isIndicatorMessage({ type: "yurei:cursor", x: 1, y: 2 }), true);
  assert.equal(isIndicatorMessage({ type: "yurei:cursor", x: "1", y: 2 }), false);
  assert.equal(isIndicatorMessage({ type: "yurei:hide" }), true);
  assert.equal(isIndicatorMessage({ type: "yurei:stop" }), false);
});
