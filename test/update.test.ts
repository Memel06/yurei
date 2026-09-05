import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { latestVersion } from "../yurei-kit/src/update";
import { useTempHome } from "./helpers";

const home = useTempHome();

test("the update check honours the opt-out and a fresh cache without touching the network", async () => {
  const saved = process.env["YUREI_NO_UPDATE_CHECK"];
  process.env["YUREI_NO_UPDATE_CHECK"] = "1";
  try {
    assert.equal(await latestVersion(), null);
  } finally {
    if (saved === undefined) delete process.env["YUREI_NO_UPDATE_CHECK"];
    else process.env["YUREI_NO_UPDATE_CHECK"] = saved;
  }
  mkdirSync(join(home(), ".yurei"), { recursive: true });
  writeFileSync(
    join(home(), ".yurei", "update-check.json"),
    JSON.stringify({ checkedAt: Date.now(), latest: "9.9.9" }),
  );
  assert.equal(await latestVersion(), "9.9.9");
});
