import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";
import { isRecord } from "../shared/protocol";

/** Points every home-relative path at a throwaway directory for the whole test file, so real configs stay untouched. */
export function useTempHome(): () => string {
  let home = "";
  const saved = new Map<string, string | undefined>();
  before(() => {
    home = mkdtempSync(join(tmpdir(), "yurei-test-"));
    const overrides = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") };
    for (const [key, value] of Object.entries(overrides)) {
      saved.set(key, process.env[key]);
      process.env[key] = value;
    }
  });
  after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  });
  return () => home;
}

export function parseJson(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  assert.ok(isRecord(value), "expected a JSON object");
  return value;
}

/** Walks a path of keys through nested objects, failing loudly where the shape is not an object. */
export function field(value: unknown, ...path: ReadonlyArray<string>): unknown {
  let current = value;
  for (const key of path) {
    assert.ok(isRecord(current), `expected an object before "${key}"`);
    current = current[key];
  }
  return current;
}
