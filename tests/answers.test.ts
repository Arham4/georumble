import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAnswer } from "../shared/answers.ts";

test("lowercases and trims", () => {
  assert.equal(normalizeAnswer("  Ivory Coast  "), "ivory coast");
});

test("strips punctuation the validator ignores", () => {
  assert.equal(normalizeAnswer("Côte d'Ivoire.".replace("d'", "d-")), "côte divoire");
});

test("periods, commas and hyphens vanish", () => {
  assert.equal(normalizeAnswer("Guinea-Bissau"), "guineabissau");
  assert.equal(normalizeAnswer("Washington, D.C."), "washington dc");
});

test("collapses to the same key for validator-unique names", () => {
  assert.equal(normalizeAnswer("Saint Basil's Cathedral"), normalizeAnswer("saint basil's cathedral"));
});
