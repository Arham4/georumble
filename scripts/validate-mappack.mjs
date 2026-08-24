#!/usr/bin/env node
// CLI wrapper: validates MapPack JSON files against docs/mappack-contract.md
// via the pure checks in lib/mappack-contract.mjs, and when a sibling
// <packId>.topojson exists, cross-checks the geometry join so an id mismatch
// can never ship as a blank map.
// Usage: node scripts/validate-mappack.mjs <pack.json> [more.json ...]

import { readFile } from "node:fs/promises";
import { validateGeometryJoin, validatePack } from "./lib/mappack-contract.mjs";

async function main() {
  const packPaths = process.argv.slice(2);
  if (packPaths.length === 0) {
    console.error("Usage: node scripts/validate-mappack.mjs <pack.json> [more.json ...]");
    process.exitCode = 1;
    return;
  }

  let failed = false;
  let validatedFeatures = 0;
  for (const packPath of packPaths) {
    let pack;
    try {
      pack = JSON.parse(await readFile(packPath, "utf8"));
    } catch (error) {
      console.error(`${packPath}: INVALID — ${error.message}`);
      failed = true;
      continue;
    }

    const violations = validatePack(pack);
    if (violations.length === 0) {
      violations.push(...(await validateGeometryJoin(packPath, pack)));
    }
    if (violations.length > 0) {
      failed = true;
      console.error(`${packPath}: INVALID (${violations.length} violation${violations.length === 1 ? "" : "s"})`);
      for (const violation of violations) console.error(`  - ${violation}`);
    } else {
      validatedFeatures += pack.features.length;
      console.log(`${packPath}: VALID — ${pack.features.length} features, packId "${pack.packId}"`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log(`All packs passed validation (${validatedFeatures} features total).`);
  }
}

await main();
