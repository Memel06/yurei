import assert from "node:assert/strict";
import { test } from "node:test";
import { clean, clip, errorMessage, fold, quote, tokenize, truncateText } from "../yurei-extension/src/text-utils";

test("clean, clip and quote", () => {
  assert.equal(clean("  a \n\t b  "), "a b");
  assert.equal(clean(null), "");
  assert.equal(clip("abcdef", 3), "abc…");
  assert.equal(clip("abc", 3), "abc");
  assert.equal(quote('say "hi"'), '"say \\"hi\\""');
});

test("truncateText cuts at a line boundary and says what was left out", () => {
  assert.equal(truncateText("short", 100, "hint"), "short");
  const text = "line one\nline two\nline three";
  assert.equal(truncateText(text, 12, "read less"), "line one\n[truncated at 12 of 28 chars; read less]");
  assert.equal(truncateText("no newline here at all", 5, "h"), "no ne\n[truncated at 5 of 22 chars; h]");
});

test("errorMessage", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("plain"), "plain");
  assert.equal(errorMessage(42), "42");
});

test("fold lowers case and strips Latin accents but keeps other scripts intact", () => {
  assert.equal(fold("Città Café ÉCOLE Straße"), "citta cafe ecole straße");
  assert.equal(fold("がぎぐ"), "がぎぐ");
  assert.equal(fold("हिन्दी"), "हिन्दी");
});

test("tokenize keeps words of any script and drops single Latin letters and digits", () => {
  assert.deepEqual(tokenize("the Città search 検索 a 1 next-step user@x.io"), [
    "the",
    "citta",
    "search",
    "検索",
    "next-step",
    "user@x.io",
  ]);
  assert.deepEqual(tokenize("書"), ["書"]);
  assert.deepEqual(tokenize("l'accesso è qui"), ["l'accesso", "qui"], "è folds to a lone e, which is noise");
  assert.deepEqual(tokenize("  "), []);
});
