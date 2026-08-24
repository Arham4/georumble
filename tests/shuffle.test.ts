import assert from "node:assert/strict";
import test from "node:test";
import { seededShuffle } from "../client/src/game/shuffle.ts";

test("same seed produces the same order", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g"];
  assert.deepEqual(seededShuffle(items, 42), seededShuffle(items, 42));
});

test("different seeds usually differ", () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const orders = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(seededShuffle(items, s))));
  assert.ok(orders.size > 10, "20 seeds collapsing to few orders means the RNG is broken");
});

test("output is a permutation of the input", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const out = seededShuffle(items, 7);
  assert.equal(out.length, items.length);
  assert.deepEqual([...out].sort((a, b) => a - b), items);
});

test("input is not mutated", () => {
  const items = [1, 2, 3, 4, 5];
  const copy = [...items];
  seededShuffle(items, 9);
  assert.deepEqual(items, copy);
});
