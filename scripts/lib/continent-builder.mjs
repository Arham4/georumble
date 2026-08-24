// Shared builder for continent packs: pre-projected conic conformal maps cut
// from world-atlas countries-50m. Encapsulates the pattern proven by
// build-europe.mjs — a per-continent script supplies config (selection, fit
// window, parallels, canvas) and this module does the geometry work.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { splitRingAtAntimeridian } from "./world-builder.mjs";
import { areaAndCentroid, decodeArcs, encodeArcsFromRings, ringPoints } from "./topo-utils.mjs";

const OUT_DIR = path.resolve(import.meta.dirname, "../../assets/mappacks");
const SOURCES = [
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json",
  "https://unpkg.com/world-atlas@2/countries-50m.json",
];

export async function fetchWorldTopology() {
  const failures = [];
  for (const url of SOURCES) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const topology = await response.json();
      if (!topology?.objects?.countries?.geometries) throw new Error("not a countries TopoJSON");
      console.log(`Downloaded ${url}`);
      return topology;
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`All sources failed:\n  ${failures.join("\n  ")}`);
}

async function loadD3Geo() {
  // Borrowed from the client's dependencies so scripts stay dependency-free.
  return import(
    pathToFileURL(path.resolve(import.meta.dirname, "../../client/node_modules/d3-geo/src/index.js"))
  );
}

/**
 * Decodes a geometry into lon/lat polygon rings: [[[lon,lat],...],...].
 * Rings are cut at the antimeridian first — a ring straddling lon ±180
 * (Chukotka) would otherwise project with a canvas-spanning wrap segment
 * whose fill renders as a solid rectangle.
 */
function decodePolygons(geometry, arcAt) {
  const polygonsOf =
    geometry.type === "Polygon" ? [geometry.arcs]
    : geometry.type === "MultiPolygon" ? geometry.arcs
    : [];
  return polygonsOf.map((polygon) =>
    polygon.flatMap((ring) => splitRingAtAntimeridian(ringPoints(ring, arcAt))),
  );
}

/**
 * Clips a projected closed ring to the canvas rectangle (Sutherland–Hodgman).
 * Geometry poking past the frame — Arctic islands above the fit window,
 * far-side antimeridian pieces wrapping around the cone — comes back with a
 * clean straight cut at the edge instead of shipping out-of-canvas arcs.
 */
function clipRingToCanvas(ring, width, height, pad = 2) {
  const limits = { left: -pad, right: width + pad, top: -pad, bottom: height + pad };
  const inside = {
    left: ([x]) => x >= limits.left,
    right: ([x]) => x <= limits.right,
    top: ([, y]) => y >= limits.top,
    bottom: ([, y]) => y <= limits.bottom,
  };
  const meet = (a, b, side) => {
    if (side === "left" || side === "right") {
      const x = limits[side];
      return [x, a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1])];
    }
    const y = limits[side];
    return [a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), y];
  };

  let output = ring;
  for (const side of ["left", "right", "top", "bottom"]) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const prev = input[(i + input.length - 1) % input.length];
      const curr = input[i];
      if (inside[side](curr)) {
        if (!inside[side](prev)) output.push(meet(prev, curr, side));
        output.push(curr);
      } else if (inside[side](prev)) {
        output.push(meet(prev, curr, side));
      }
    }
    if (output.length < 3) return [];
  }
  return output;
}

/**
 * Builds and writes one continent pack.
 *
 * config:
 *   packId, displayName       — contract identity
 *   canvas                    — { width, height } of the pre-projected canvas
 *   fit                       — { minLon, minLat, maxLon, maxLat } framing window;
 *                               outlying geometry clips at the canvas edge
 *   parallels, rotate         — geoConicConformal setup (rotate: [centerLon])
 *   selection                 — { "356": { iso2: "IN", name: "India", aliases?: [] } }
 *                               keyed by world-atlas ISO numeric id
 *   helpers                   — optional [{ id, at: [lon, lat] }] offshore circle anchors
 */
export async function buildContinentPack(config) {
  const topology = await fetchWorldTopology();
  const { geoConicConformal } = await loadD3Geo();
  const project = geoConicConformal().parallels(config.parallels).rotate([config.rotate, 0]);
  const arcAt = decodeArcs(topology);
  const { arcs, toArcIndexes } = encodeArcsFromRings();

  const numericId = (geometry) => String(Number(String(geometry.id)));
  const selected = topology.objects.countries.geometries.filter(
    (geometry) => config.selection[numericId(geometry)] !== undefined,
  );
  const missing = Object.keys(config.selection).filter(
    (id) => !selected.some((geometry) => numericId(geometry) === id),
  );
  if (missing.length > 0) {
    throw new Error(`Source atlas is missing selected countries: ${missing.join(", ")}`);
  }

  // Measure the fit window's pixel bbox by sampling its edges densely — a
  // conic projection curves straight lon/lat edges, so corners alone
  // underestimate the frame (coastal specks would drop off the edge).
  const { minLon, minLat, maxLon, maxLat } = config.fit;
  const edgeSamples = [];
  const STEPS = 40;
  const pushEdge = (from, to) => {
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      edgeSamples.push(project([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]));
    }
  };
  pushEdge([minLon, minLat], [maxLon, minLat]);
  pushEdge([maxLon, minLat], [maxLon, maxLat]);
  pushEdge([maxLon, maxLat], [minLon, maxLat]);
  pushEdge([minLon, maxLat], [minLon, minLat]);
  const xs = edgeSamples.map(([x]) => x);
  const ys = edgeSamples.map(([, y]) => y);
  const box = {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  const pad = 8;
  const k = Math.min(
    (config.canvas.width - pad * 2) / box.width,
    (config.canvas.height - pad * 2) / box.height,
  );
  const offX = (config.canvas.width - box.width * k) / 2;
  const offY = (config.canvas.height - box.height * k) / 2;
  const toPixel = ([lon, lat]) => {
    const [x, y] = project([lon, lat]);
    return [(x - box.minX) * k + offX, (y - box.minY) * k + offY];
  };

  const geometries = [];
  const features = [];
  const inCanvas = ([x, y]) =>
    x >= -2 && x <= config.canvas.width + 2 && y >= -2 && y <= config.canvas.height + 2;
  for (const geometry of selected) {
    const meta = config.selection[numericId(geometry)];
    const polygons = decodePolygons(geometry, arcAt)
      .map((polygon) =>
        polygon
          .map((ring) => ring.map(toPixel).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])))
          // Specks fully outside the frame (africa's Prince Edward Islands)
          // would otherwise ship as invisible out-of-canvas arcs.
          .filter((ring) => ring.length >= 4 && ring.some(inCanvas)),
      )
      .filter((polygon) => polygon.length > 0);
    if (polygons.length === 0) {
      console.warn(`Skipping ${meta.name}: geometry collapses under projection`);
      continue;
    }

    let bestCentroid = null;
    for (const polygon of polygons) {
      const candidate = areaAndCentroid(polygon[0]);
      if (candidate && (!bestCentroid || candidate.absArea > bestCentroid.absArea)) {
        bestCentroid = candidate;
      }
    }

    const arcsPolygons = polygons.map((polygon) => polygon.map((ring) => toArcIndexes(ring)));
    const isMulti = arcsPolygons.length > 1;
    geometries.push({
      id: meta.iso2,
      type: isMulti ? "MultiPolygon" : "Polygon",
      arcs: isMulti ? arcsPolygons : arcsPolygons[0],
    });

    const feature = { id: meta.iso2, name: meta.name };
    if (meta.aliases?.length) {
      feature.aliases = meta.aliases;
    }
    if (bestCentroid) {
      feature.centroidHint = {
        x: Math.round(bestCentroid.x),
        y: Math.round(bestCentroid.y),
      };
    }
    features.push(feature);
  }

  features.sort((a, b) => a.name.localeCompare(b.name));

  const helpers = (config.helpers ?? []).map(({ id, at }) => {
    const [x, y] = toPixel(at);
    return { id, anchor: { x: Math.round(x), y: Math.round(y) } };
  });

  const pack = {
    packId: config.packId,
    displayName: config.displayName,
    projection: {
      kind: "conic-conformal-preprojected",
      width: config.canvas.width,
      height: config.canvas.height,
    },
    source: {
      name: "world-atlas countries-50m.json (Natural Earth 1:50m)",
      url: "https://github.com/topojson/world-atlas",
      license: "Public domain (Natural Earth data)",
    },
    features,
    ...(helpers.length ? { helpers } : {}),
  };

  const outTopology = {
    type: "Topology",
    objects: { countries: { type: "GeometryCollection", geometries } },
    arcs,
    transform: { scale: [1, 1], translate: [0, 0] },
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, `${config.packId}.topojson`), `${JSON.stringify(outTopology)}\n`);
  await writeFile(
    path.join(OUT_DIR, `${config.packId}.mappack.json`),
    `${JSON.stringify(pack, null, 2)}\n`,
  );
  console.log(`${config.packId}: ${features.length} features, canvas ${config.canvas.width}x${config.canvas.height}`);
}
