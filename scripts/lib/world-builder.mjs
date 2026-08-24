// Shared builder for the world-frame packs (continents, oceans): one identical
// pre-projected equirectangular frame so the two maps align visually as a set.
// Same shape as continent-builder — thin entry scripts supply features, this
// module does framing, antimeridian splitting, projection, and encoding.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { areaAndCentroid, encodeArcsFromRings } from "./topo-utils.mjs";

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

// Lat trimmed at 85N: pole stretch buys no clickable space, while Antarctica
// at the bottom IS a feature so -90S stays fully in frame.
const FRAME = { minLon: -180, maxLon: 180, minLat: -90, maxLat: 85 };
const CANVAS_WIDTH = 1000;
const PAD = 8;

let cachedFrame = null;

/** Letterboxes the frame into a 1000-wide canvas; plain equirectangular is
 * linear, so projecting the four corners measures the box exactly. */
async function worldFrame() {
  if (cachedFrame) return cachedFrame;
  const { geoEquirectangular } = await loadD3Geo();
  const project = geoEquirectangular();
  const corners = [
    project([FRAME.minLon, FRAME.minLat]),
    project([FRAME.maxLon, FRAME.minLat]),
    project([FRAME.maxLon, FRAME.maxLat]),
    project([FRAME.minLon, FRAME.maxLat]),
  ];
  const minX = Math.min(...corners.map(([x]) => x));
  const maxX = Math.max(...corners.map(([x]) => x));
  const minY = Math.min(...corners.map(([, y]) => y));
  const maxY = Math.max(...corners.map(([, y]) => y));

  const innerWidth = CANVAS_WIDTH - PAD * 2;
  const k = innerWidth / (maxX - minX);
  const height = Math.round(innerWidth * ((maxY - minY) / (maxX - minX))) + PAD * 2;
  const offX = PAD;
  const offY = (height - (maxY - minY) * k) / 2;

  cachedFrame = {
    canvas: { width: CANVAS_WIDTH, height },
    toPixel: ([lon, lat]) => {
      const [x, y] = project([lon, lat]);
      return [(x - minX) * k + offX, (y - minY) * k + offY];
    },
  };
  return cachedFrame;
}

/**
 * Cuts a lon/lat ring into rings that never cross lon ±180. Rings straddling
 * the seam (Chukotka, Antarctica) otherwise draw a straight line across the
 * whole canvas when projected. Longitudes are first unwrapped into a
 * continuous space (so a 10-degree step onto the seam is not mistaken for a
 * 350-degree jump), then the ring is divided wherever it leaves the
 * [-180, 180] band; pieces landing in the same band are successive segments
 * of ONE ring and are concatenated in order, their shared seam stretch
 * becoming an ordinary vertical ring edge.
 */
export function splitRingAtAntimeridian(ring) {
  const points = ring.slice();
  while (
    points.length > 1 &&
    points[0][0] === points.at(-1)[0] &&
    points[0][1] === points.at(-1)[1]
  ) {
    points.pop();
  }
  if (points.length === 0) return [];

  const count = points.length;
  const seq = [[points[0][0], points[0][1]]];
  for (let i = 1; i <= count; i++) {
    const raw = points[i % count];
    let lon = raw[0];
    while (lon - seq[i - 1][0] > 180) lon -= 360;
    while (lon - seq[i - 1][0] < -180) lon += 360;
    seq.push([lon, raw[1]]);
  }

  // Exact ±180 counts as in-frame: authored rings often run ALONG the seam,
  // and only strict excursions past it are far-band geometry.
  const bandOf = (lon) => (lon > 180 ? 1 : lon < -180 ? -1 : 0);

  const runsByBand = new Map();
  let band = bandOf(seq[0][0]);
  let run = [seq[0]];
  const flushRun = () => {
    if (!runsByBand.has(band)) runsByBand.set(band, []);
    runsByBand.get(band).push(run);
  };
  for (let i = 1; i <= count; i++) {
    const [lon, lat] = seq[i];
    const nextBand = bandOf(lon);
    if (nextBand === band) {
      run.push(seq[i]);
      continue;
    }
    const boundary = Math.max(band, nextBand) > 0 ? 180 : -180;
    const seamLat = run.at(-1)[1] + ((boundary - run.at(-1)[0]) / (lon - run.at(-1)[0])) * (lat - run.at(-1)[1]);
    run.push([boundary, seamLat]);
    flushRun();
    band = nextBand;
    run = [[boundary, seamLat]];
  }
  // The i === count pass already revisits the starting point, so the last run
  // is closed against the first; fold it into its band like any other.
  if (run.length > 1) flushRun();

  return [...runsByBand.values()]
    .map((runs) => runs.flat())
    .filter((pts) => pts.length >= 4)
    .map((pts) => {
      // Re-seat each ring in the canonical frame: a far-band chunk (Chukotka
      // beyond 180E) shifts back to the opposite edge, an ordinary ring
      // barely moves.
      const meanLon = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
      const shift = -Math.round(meanLon / 360) * 360;
      return pts.map(([lon, lat]) => [lon + shift, lat]);
    });
}

/**
 * Builds and writes one world-frame pack.
 *
 * config:
 *   packId, displayName       — contract identity
 *   source                    — { name, url?, license }
 *   features                  — [{ id, name, aliases?, parts }] where parts is an
 *                               array of lon/lat polygons, each an array of
 *                               outer-only rings [[[lon,lat],...],...]
 */
export async function buildWorldPack(config) {
  const { canvas, toPixel } = await worldFrame();
  const { arcs, toArcIndexes } = encodeArcsFromRings();

  const geometries = [];
  const features = [];
  for (const spec of config.features) {
    const projectedParts = spec.parts
      .map((part) =>
        part
          .flatMap(splitRingAtAntimeridian)
          .map((ring) =>
            ring.map(toPixel).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
          )
          .filter((ring) => ring.length >= 4),
      )
      // Seam splitting sheds zero-width slivers; sub-pixel parts are invisible
      // specks at ~0.36 degrees per pixel, so dropping them costs nothing.
      .map((rings) => rings.filter((ring) => (areaAndCentroid(ring)?.absArea ?? 0) >= 0.5))
      .filter((rings) => rings.length > 0);
    if (projectedParts.length === 0) {
      throw new Error(`${spec.name}: all geometry collapses under projection`);
    }

    let bestCentroid = null;
    for (const rings of projectedParts) {
      const candidate = areaAndCentroid(rings[0]);
      if (candidate && (!bestCentroid || candidate.absArea > bestCentroid.absArea)) {
        bestCentroid = candidate;
      }
    }

    const arcsParts = projectedParts.map((rings) => rings.map((ring) => toArcIndexes(ring)));
    geometries.push({
      id: spec.id,
      type: arcsParts.length > 1 ? "MultiPolygon" : "Polygon",
      arcs: arcsParts.length > 1 ? arcsParts : arcsParts[0],
    });

    const feature = { id: spec.id, name: spec.name };
    if (spec.aliases?.length) feature.aliases = spec.aliases;
    feature.centroidHint = {
      x: Math.round(bestCentroid.x),
      y: Math.round(bestCentroid.y),
    };
    features.push(feature);
  }

  const pack = {
    packId: config.packId,
    displayName: config.displayName,
    projection: {
      kind: "equirectangular-geo",
      width: canvas.width,
      height: canvas.height,
    },
    source: config.source,
    features,
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
  console.log(`${config.packId}: ${features.length} features, canvas ${canvas.width}x${canvas.height}`);
}
