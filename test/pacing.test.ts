import assert from "node:assert/strict";
import { test } from "node:test";
import { movePath, siteOf, takeTurn } from "../yurei-extension/src/pacing";

test("siteOf keys a budget on the registrable domain and skips local addresses", () => {
  assert.equal(siteOf("https://www.google.co.uk/search?q=x"), "google.co.uk");
  assert.equal(siteOf("https://shop.example.com/cart"), "example.com");
  assert.equal(siteOf("https://a.b.example.com.br/"), "example.com.br");
  assert.equal(siteOf("http://192.168.1.1/admin"), "192.168.1.1");
  assert.equal(siteOf("https://intranet/"), "intranet");
  assert.equal(siteOf("http://localhost:3000/"), "");
  assert.equal(siteOf("http://127.0.0.1:8080/"), "");
  assert.equal(siteOf("http://dev.local/"), "");
  assert.equal(siteOf("not a url"), "");
  assert.equal(siteOf("about:blank"), "");
});

test("movePath jumps for tiny moves and eases through intermediate points otherwise", () => {
  const to = { x: 400, y: 300 };
  assert.deepEqual(movePath(null, to), [to]);
  assert.deepEqual(movePath({ x: 396, y: 302 }, to), [to]);
  const path = movePath({ x: 0, y: 0 }, to);
  assert.ok(path.length >= 2 && path.length <= 10, `${path.length} points`);
  assert.deepEqual(path.at(-1), to);
  for (const point of path) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(point.x >= -30 && point.x <= 430 && point.y >= -30 && point.y <= 330, "the bow stays near the line");
  }
});

test("takeTurn lets a burst through, then makes the same site wait; local pages never wait", async () => {
  const site = `https://burst-${Date.now()}.example/`;
  const start = Date.now();
  for (let i = 0; i < 6; i++) await takeTurn(site, "action");
  assert.ok(Date.now() - start < 300, "the burst is immediate");
  const before = Date.now();
  await takeTurn(site, "action");
  const waited = Date.now() - before;
  assert.ok(waited >= 300 && waited < 3000, `waited ${waited}ms`);
  const other = Date.now();
  await takeTurn("https://other.example/", "action");
  await takeTurn("http://localhost:1234/", "action");
  assert.ok(Date.now() - other < 300, "other sites and localhost are not held up");
});
