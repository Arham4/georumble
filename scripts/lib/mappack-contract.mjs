// Pure MapPack contract checks, split out of validate-mappack.mjs so tests can
// import them without triggering the CLI. Mirrors docs/mappack-contract.md.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeAnswer } from "../../shared/answers.ts";

const PACK_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const KNOWN_PROJECTIONS = new Set([
  "albers-usa-preprojected",
  "conic-conformal-preprojected",
  "equirectangular-geo",
  "mercator-preprojected",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Returns the list of contract violations for one parsed pack (empty = valid). */
export function validatePack(pack) {
  const violations = [];

  const require = (condition, message) => {
    if (!condition) violations.push(message);
    return condition;
  };

  require(pack && typeof pack === "object" && !Array.isArray(pack), "not a JSON object");
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

  if (pack.helpers !== undefined) {
    if (!require(Array.isArray(pack.helpers), "helpers must be an array")) {
      return violations;
    }
    const seenHelpers = new Set();
    const canvasOk =
      isFiniteNumber(pack.projection.width) && isFiniteNumber(pack.projection.height);
    pack.helpers.forEach((helper, index) => {
      const where = `helpers[${index}]`;
      if (!require(helper && typeof helper === "object" && !Array.isArray(helper), `${where}: must be an object`)) {
        return;
      }
      if (require(isNonEmptyString(helper.id), `${where}.id must be a non-empty string`)) {
        require(!seenHelpers.has(helper.id), `duplicate helper for id "${helper.id}"`);
        seenHelpers.add(helper.id);
        require(seenIds.has(helper.id), `${where}.id "${helper.id}" does not match any feature`);
      }
      const anchor = helper.anchor;
      const validAnchor =
        anchor && typeof anchor === "object" && isFiniteNumber(anchor.x) && isFiniteNumber(anchor.y);
      require(validAnchor, `${where}.anchor must be { x: number, y: number } with finite values`);
      if (validAnchor && canvasOk) {
        require(
          anchor.x >= 0 &&
            anchor.x <= pack.projection.width &&
            anchor.y >= 0 &&
            anchor.y <= pack.projection.height,
          `${where}.anchor must sit inside the projection canvas`,
        );
      }
    });
  }

  const answerOwners = new Map();
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

/**
 * The renderer plots the LARGEST GeometryCollection in the file, so the id
 * join must be checked against that same object — keying on the first object
 * would green-light packs whose visible map never matches the features list.
 */
function renderedCollection(topology) {
  let largest = null;
  for (const object of Object.values(topology.objects ?? {})) {
    if (object?.type !== "GeometryCollection") {
      continue;
    }
    if (!largest || (object.geometries?.length ?? 0) > largest.geometries.length) {
      largest = object;
    }
  }
  return largest;
}

/**
 * Feature ids must join 1:1 onto the sibling <packId>.topojson's geometry ids,
 * so an id mismatch can never ship as a blank or unnamed map.
 */
export async function validateGeometryJoin(packPath, pack) {
  const topoPath = path.join(path.dirname(packPath), `${pack.packId}.topojson`);
  let topology;
  try {
    topology = JSON.parse(await readFile(topoPath, "utf8"));
  } catch {
    return []; // No sibling geometry to check; the JSON contract stands alone.
  }
  const geometryIds = new Set(
    (renderedCollection(topology)?.geometries ?? []).map((geometry) => String(geometry.id)),
  );
  const violations = [];
  for (const feature of pack.features) {
    if (!geometryIds.has(feature.id)) {
      violations.push(`feature id "${feature.id}" has no TopoJSON geometry — would render blank`);
    }
  }
  const featureIds = new Set(pack.features.map((feature) => feature.id));
  for (const geometryId of geometryIds) {
    if (!featureIds.has(geometryId)) {
      violations.push(`TopoJSON geometry "${geometryId}" has no pack feature — would render unnamed`);
    }
  }
  return violations;
}
