// Point-of-interest pack builder: turns a plain data table of {id, name,
// aliases?, lon, lat} into contract-shaped dot targets — small geodesic
// circles on the shared world frame — so cities/landmarks/capitals packs are
// pure data files and this stays the only place dot mechanics live.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildWorldPack } from "./world-builder.mjs";

async function loadD3Geo() {
  // Borrowed from the client's dependencies so scripts stay dependency-free.
  return import(
    pathToFileURL(path.resolve(import.meta.dirname, "../../client/node_modules/d3-geo/src/index.js"))
  );
}

/**
 * config:
 *   packId, displayName, source — contract identity
 *   points                      — [{ id, name, aliases?, lon, lat }]
 *   radiusDegrees               — dot radius in degrees (default 2.5 ≈ 7px
 *                                 on the 1000-wide world frame); the client's
 *                                 fat-stroke halos keep small dots clickable
 *   background                  — optional lon/lat polygon parts (land underlay)
 *                                 emitted as the non-interactive background object
 */
export async function buildPoiPack(config) {
  const points = config.points;
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error("poi pack needs a non-empty points table");
  }
  const seen = new Set();
  for (const point of points) {
    if (seen.has(point.id)) {
      throw new Error(`duplicate poi id "${point.id}"`);
    }
    seen.add(point.id);
    if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) {
      throw new Error(`${point.id}: lon/lat must be finite numbers`);
    }
  }

  const { geoCircle } = await loadD3Geo();
  const radiusDegrees = config.radiusDegrees ?? 2.5;
  const circle = geoCircle().radius(radiusDegrees).precision(6);

  await buildWorldPack({
    packId: config.packId,
    displayName: config.displayName,
    source: config.source,
    background: config.background,
    features: points.map(({ lon, lat, ...meta }) => ({
      ...meta,
      parts: [circle.center([lon, lat])().coordinates],
    })),
  });
  console.log(
    `${config.packId}: ${points.length} points, radius ${radiusDegrees}°`,
  );
}
