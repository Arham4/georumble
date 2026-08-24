// Integration net: every shipped pack must satisfy the contract AND join 1:1
// onto its sibling topojson — the failure mode that renders blank maps.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { validateGeometryJoin, validatePack } from "../scripts/lib/mappack-contract.mjs";

const PACKS_DIR = path.resolve(import.meta.dirname, "../assets/mappacks");

test("every shipped mappack passes the contract and geometry join", async () => {
  const files = (await readdir(PACKS_DIR)).filter((f) => f.endsWith(".mappack.json"));
  assert.ok(files.length >= 5, `expected the shipped packs to exist, found ${files.length}`);

  for (const file of files) {
    const packPath = path.join(PACKS_DIR, file);
    const pack = JSON.parse(await readFile(packPath, "utf8"));
    const violations = [...validatePack(pack), ...(await validateGeometryJoin(packPath, pack))];
    assert.deepEqual(violations, [], `${file} violates the contract`);
  }
});
