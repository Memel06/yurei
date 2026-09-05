import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUrl } from "../yurei-extension/src/urls";

test("full URLs pass through untouched", () => {
  for (const url of [
    "https://example.com/x?y=1",
    "http://a.b/",
    "chrome://extensions",
    "about:blank",
    "mailto:a@b.c",
    "view-source:https://x.y",
  ]) {
    assert.equal(normalizeUrl(url), url);
  }
});

test("hosts get a scheme, local ones a plain one", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com");
  assert.equal(normalizeUrl("  example.com/path?q=1  "), "https://example.com/path?q=1");
  assert.equal(normalizeUrl("shop.example.co.uk"), "https://shop.example.co.uk");
  assert.equal(normalizeUrl("localhost:3000/app"), "http://localhost:3000/app");
  assert.equal(normalizeUrl("127.0.0.1"), "http://127.0.0.1");
  assert.equal(normalizeUrl("192.168.1.1:8080/admin"), "http://192.168.1.1:8080/admin");
});

test("anything else becomes a web search", () => {
  assert.equal(normalizeUrl("what is the weather"), "https://www.google.com/search?q=what%20is%20the%20weather");
  assert.equal(normalizeUrl("yurei chrome extension"), "https://www.google.com/search?q=yurei%20chrome%20extension");
});
