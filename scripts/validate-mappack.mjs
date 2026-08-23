#!/usr/bin/env node
// Validates MapPack JSON files against docs/mappack-contract.md.
// Usage: node scripts/validate-mappack.mjs <pack.json> [more.json ...]

import { readFile } from "node:fs/promises";

const PACK_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KNOWN_PROJECTIONS = new Set([
  "albers-usa-preprojected",
  "conic-conformal-preprojected",
  "equirectangular-geo",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeAnswer(text) {
  return text.trim().toLowerCase().replaceAll(/[.,\-]/g, "");
}

function validate(packPath, pack) {
  const violations = [];

  const require = (condition, message) => {
    if (!condition) violations.push(message);
    return condition;
  };

  require(pack && typeof pack === "object" && !Array.isArray(pack), `${packPath}: not a JSON object`);
  if (violations.length > 0) return violations;

  if (require(isNonEmptyString(pack.packId), "packId must be a non-empty string")) {
    require(PACK_ID_PATTERN.test(pack.packId), `packId "${pack.packId}" must be lowercase kebab-case`);
  }
  require(isNonEmptyString(pack.displayName), "displayName must be a non-empty string");

  const projection = pack.projection;
  if (require(projection && typeof projection === "object", "projection must be an object")) {
    require(
      KNOWN_PROJECTIONS.has(projection.kind),
      `projection.kind "${projection.kind}" must be one of ${[...KNOWN_PROJECTIONS].join(", ")}`,
    );
    require(isFiniteNumber(projection.width) && projection.width > 0, "projection.width must be a number > 0");
    require(isFiniteNumber(projection.height) && projection.height > 0, "projection.height must be a number > 0");
  }

  const source = pack.source;
  if (require(source && typeof source === "object", "source must be an object")) {
    require(isNonEmptyString(source.name), "source.name must be a non-empty string");
    require(isNonEmptyString(source.license), "source.license must be a non-empty string");
  }

  if (!require(Array.isArray(pack.features) && pack.features.length > 0, "features must be a non-empty array")) {
    return violations;
  }

  const seenIds = new Set();
  const answerOwners = new Map();
  pack.features.forEach((feature, index) => {
    const where = `features[${index}]`;
    if (!require(feature && typeof feature === "object" && !Array.isArray(feature), `${where}: must be an object`)) {
      return;
    }

    if (require(isNonEmptyString(feature.id), `${where}.id must be a non-empty string`)) {
      require(!seenIds.has(feature.id), `duplicate feature id "${feature.id}"`);
      seenIds.add(feature.id);
    }
    require(isNonEmptyString(feature.name), `${where}.name must be a non-empty string`);

    if (feature.aliases !== undefined) {
      if (require(Array.isArray(feature.aliases), `${where}.aliases must be an array`)) {
        feature.aliases.forEach((alias, aliasIndex) => {
          require(isNonEmptyString(alias), `${where}.aliases[${aliasIndex}] must be a non-empty string`);
        });
        const uniqueAliases = new Set(feature.aliases.map(normalizeAnswer));
        require(
          uniqueAliases.size === feature.aliases.length,
          `${where} ("${feature.name}") has duplicate aliases`,
        );
      }
    }

    if (feature.centroidHint !== undefined) {
      const hint = feature.centroidHint;
      const validHint =
        hint && typeof hint === "object" && isFiniteNumber(hint.x) && isFiniteNumber(hint.y);
      require(validHint, `${where}.centroidHint must be { x: number, y: number } with finite values`);
    }
  });
  if (violations.length > 0) return violations;

  for (const feature of pack.features) {
    for (const answer of [feature.name, ...(feature.aliases ?? [])]) {
      const key = normalizeAnswer(answer);
      const owner = answerOwners.get(key);
      if (owner && owner !== feature.id) {
        violations.push(`answer "${answer}" claimed by both "${owner}" and "${feature.id}"`);
      } else {
        answerOwners.set(key, feature.id);
      }
    }
  }

  return violations;
}

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

    const violations = validate(packPath, pack);
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
