import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewer } from "../shared/semver";

test("isNewer compares major.minor.patch and ignores prerelease tags", () => {
  assert.equal(isNewer("0.3.1", "0.3.0"), true);
  assert.equal(isNewer("0.4.0", "0.3.9"), true);
  assert.equal(isNewer("1.0.0", "0.9.9"), true);
  assert.equal(isNewer("0.3.0", "0.3.0"), false);
  assert.equal(isNewer("0.2.9", "0.3.0"), false);
  assert.equal(isNewer("0.3.0-beta.1", "0.3.0"), false);
  assert.equal(isNewer("0.3.1-rc.1", "0.3.0"), true);
  assert.equal(isNewer("0.3", "0.2.5"), true);
  assert.equal(isNewer("garbage", "0.1.0"), false);
});
