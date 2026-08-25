// Shared land-underlay fetcher for dot packs: the world's coastlines decoded
// into parts (one entry per land polygon, each an array of rings), suitable
// for buildWorldPack's `background` option.
import { decodeArcs, ringPoints } from "./topo-utils.mjs";

const LAND_SOURCES = [
  "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json",
  "https://unpkg.com/world-atlas@2/land-110m.json",
];

export async function fetchLandParts() {
  const failures = [];
  for (const url of LAND_SOURCES) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const topology = await response.json();
      const land = topology.objects?.land;
      if (!land?.geometries?.length) throw new Error("not a land TopoJSON");
      const arcAt = decodeArcs(topology);
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
