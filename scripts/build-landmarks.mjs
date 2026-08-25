#!/usr/bin/env node
// Builds the world-landmarks MapPack: the data table in scripts/data/ turned
// into dot targets on the shared world frame via the POI builder, with the
// world's landmass as a faint underlay so the dots have geographic context.
import { buildPoiPack } from "./lib/poi-builder.mjs";
import { decodeArcs, ringPoints } from "./lib/topo-utils.mjs";
import { LANDMARKS } from "./data/world-landmarks.mjs";

const LAND_SOURCES = [
  "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json",
  "https://unpkg.com/world-atlas@2/land-110m.json",
];

async function fetchLandParts() {
  const failures = [];
  for (const url of LAND_SOURCES) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const topology = await response.json();
      const land = topology.objects?.land;
      if (!land?.geometries?.length) throw new Error("not a land TopoJSON");
      const arcAt = decodeArcs(topology);
      // parts shape: one entry per land polygon, each an array of rings.
      return land.geometries.flatMap((geometry) => {
        const polygons =
          geometry.type === "Polygon" ? [geometry.arcs]
          : geometry.type === "MultiPolygon" ? geometry.arcs
          : [];
        return polygons.map((polygon) => polygon.map((ring) => ringPoints(ring, arcAt)));
      });
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`All land sources failed:\n  ${failures.join("\n  ")}`);
}

await buildPoiPack({
  packId: "world-landmarks",
  displayName: "World Landmarks",
  source: {
    name: "Hand-authored landmark coordinates; land underlay from world-atlas land-110m (Natural Earth, public domain)",
    license: "Original data; underlay public domain (Natural Earth)",
  },
  points: LANDMARKS,
  background: await fetchLandParts(),
});
