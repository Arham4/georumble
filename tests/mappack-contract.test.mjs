import assert from "node:assert/strict";
import test from "node:test";
import { validatePack } from "../scripts/lib/mappack-contract.mjs";

const basePack = () => ({
  packId: "test-pack",
  displayName: "Test Pack",
  projection: { kind: "equirectangular-geo", width: 1000, height: 500 },
  source: { name: "test", license: "public domain" },
  features: [
    { id: "AA", name: "Alpha", centroidHint: { x: 10, y: 20 } },
    { id: "BB", name: "Beta" },
  ],
});

test("a well-formed pack passes with no violations", () => {
  assert.deepEqual(validatePack(basePack()), []);
});

test("packId must be lowercase kebab-case", () => {
  for (const packId of ["TestPack", "test_pack", "test--pack", "-test", ""]) {
    const violations = validatePack({ ...basePack(), packId });
    assert.ok(violations.some((v) => v.includes("packId")), `expected packId violation for "${packId}"`);
  }
});

test("duplicate feature ids are rejected", () => {
  const pack = basePack();
  pack.features[1].id = "AA";
  assert.ok(validatePack(pack).some((v) => v.includes("duplicate feature id")));
});

test("two features claiming the same normalized answer are rejected", () => {
  const pack = basePack();
  pack.features[0].aliases = ["beta"];
  const violations = validatePack(pack);
  assert.ok(violations.some((v) => v.includes('claimed by both')));
});

test("normalization ignores case, punctuation, and surrounding space", () => {
  const pack = basePack();
  pack.features[1].aliases = ["  BETA... "];
  assert.deepEqual(validatePack(pack), []);
});

test("a feature's own aliases may not duplicate each other", () => {
  const pack = basePack();
  pack.features[1].aliases = ["Gamma", "gamma"];
  assert.ok(validatePack(pack).some((v) => v.includes("duplicate aliases")));
});

test("helpers must reference a feature and stay on canvas", () => {
  const pack = basePack();
  pack.helpers = [{ id: "ZZ", anchor: { x: 1, y: 1 } }];
  assert.ok(validatePack(pack).some((v) => v.includes("does not match any feature")));

  pack.helpers = [{ id: "AA", anchor: { x: 2000, y: 1 } }];
  assert.ok(validatePack(pack).some((v) => v.includes("inside the projection canvas")));

  pack.helpers = [{ id: "AA", anchor: { x: 500, y: 250 } }];
  assert.deepEqual(validatePack(pack), []);
});

test("unknown projection kinds are rejected", () => {
  const pack = basePack();
  pack.projection = { ...pack.projection, kind: "mercator-magic" };
  assert.ok(validatePack(pack).some((v) => v.includes("projection.kind")));
});

test("empty features array is rejected", () => {
  assert.ok(validatePack({ ...basePack(), features: [] }).some((v) => v.includes("non-empty array")));
});

test("non-object input is rejected without throwing", () => {
  assert.ok(validatePack(null).length > 0);
  assert.ok(validatePack([1]).length > 0);
  assert.ok(validatePack("nope").length > 0);
});
