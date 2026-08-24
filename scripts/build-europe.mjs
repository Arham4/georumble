#!/usr/bin/env node
// Builds the europe MapPack from Natural Earth 50m data via world-atlas
// (public domain), pre-projected with a conic conformal projection fitted to
// the European landmass. Follows docs/mappack-contract.md; shares TopoJSON
// math with the other builders via scripts/lib/topo-utils.mjs.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { areaAndCentroid, decodeArcs, encodeArcsFromRings, ringPoints } from "./lib/topo-utils.mjs";

const PACK_ID = "europe";
const DISPLAY_NAME = "Europe";
const PROJECTION_KIND = "conic-conformal-preprojected";
const CANVAS = { width: 1015, height: 640 };
const OUT_DIR = path.resolve(import.meta.dirname, "../assets/mappacks");

const SOURCES = [
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json",
  "https://unpkg.com/world-atlas@2/countries-50m.json",
];

// The map frames Europe itself; outlying polygons (Russian far east, Spanish
// Canaries, French Guiana) clip at the canvas edge instead of squishing the
// continent, because fitting uses a fixed lon/lat window, not the collection.
const FIT_LON_LAT = { minLon: -26, minLat: 33, maxLon: 52, maxLat: 72 };

// world-atlas geometry ids are ISO 3166-1 numeric strings. Alpha-2 codes serve
// as typed-answer aliases; overrides fix Natural Earth's abbreviated names.
const SELECTION = {
  "8": { iso2: "AL", name: "Albania" },
  "40": { iso2: "AT", name: "Austria" },
  "112": { iso2: "BY", name: "Belarus" },
  "56": { iso2: "BE", name: "Belgium" },
  "70": { iso2: "BA", name: "Bosnia and Herzegovina", aliases: ["Bosnia"] },
  "100": { iso2: "BG", name: "Bulgaria" },
  "191": { iso2: "HR", name: "Croatia" },
  "203": { iso2: "CZ", name: "Czechia", aliases: ["Czech Republic"] },
  "208": { iso2: "DK", name: "Denmark" },
  "233": { iso2: "EE", name: "Estonia" },
  "246": { iso2: "FI", name: "Finland" },
  "250": { iso2: "FR", name: "France" },
  "276": { iso2: "DE", name: "Germany" },
  "300": { iso2: "GR", name: "Greece", aliases: ["Hellas"] },
  "348": { iso2: "HU", name: "Hungary" },
  "352": { iso2: "IS", name: "Iceland" },
  "372": { iso2: "IE", name: "Ireland" },
  "380": { iso2: "IT", name: "Italy" },
  "428": { iso2: "LV", name: "Latvia" },
  "440": { iso2: "LT", name: "Lithuania" },
  "442": { iso2: "LU", name: "Luxembourg" },
  "470": { iso2: "MT", name: "Malta" },
  "498": { iso2: "MD", name: "Moldova" },
  "528": { iso2: "NL", name: "Netherlands", aliases: ["Holland"] },
  "807": { iso2: "MK", name: "North Macedonia", aliases: ["Macedonia"] },
  "578": { iso2: "NO", name: "Norway" },
  "616": { iso2: "PL", name: "Poland" },
  "620": { iso2: "PT", name: "Portugal" },
  "642": { iso2: "RO", name: "Romania" },
  "643": { iso2: "RU", name: "Russia" },
  "688": { iso2: "RS", name: "Serbia" },
  "703": { iso2: "SK", name: "Slovakia" },
  "705": { iso2: "SI", name: "Slovenia" },
  "724": { iso2: "ES", name: "Spain" },
  "752": { iso2: "SE", name: "Sweden" },
  "756": { iso2: "CH", name: "Switzerland" },
  "792": { iso2: "TR", name: "Turkey", aliases: ["Turkiye"] },
  "804": { iso2: "UA", name: "Ukraine" },
  "826": { iso2: "GB", name: "United Kingdom", aliases: ["UK", "Britain", "Great Britain"] },
};

// Excluded from v1: microstates too small for fair clicking (Andorra,
// Liechtenstein, Monaco, San Marino, Vatican) and Kosovo (unstable -99 id in
// the source atlas). Both are additive later under the same packId.

async function fetchTopology() {
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

async function loadProjection() {
  // d3-geo ships as ESM inside the client's dependencies; the builder borrows
  // it from there so scripts stay dependency-free themselves. Fitting is done
  // manually below (d3's fitExtent collapses on this conic setup), so the raw
  // projection is all we need.
  const d3Geo = await import(
    pathToFileURL(path.resolve(import.meta.dirname, "../client/node_modules/d3-geo/src/index.js"))
  );
  return d3Geo.geoConicConformal().parallels([35, 65]).rotate([-10, 0]);
}

/** Decodes a geometry into lon/lat polygon rings: [[[lon,lat],...],...]. */
function decodePolygons(geometry, arcAt) {
  const polygonsOf =
    geometry.type === "Polygon" ? [geometry.arcs]
    : geometry.type === "MultiPolygon" ? geometry.arcs
    : [];
  return polygonsOf.map((polygon) =>
    polygon.map((ring) => ringPoints(ring, arcAt)),
  );
}

async function main() {
  const topology = await fetchTopology();
  const project = await loadProjection();
  const arcAt = decodeArcs(topology);
  const { arcs, toArcIndexes } = encodeArcsFromRings();

  // Source ids are zero-padded ISO numerics ("008"); SELECTION keys are bare.
  const numericId = (geometry) => String(Number(String(geometry.id)));
  const selected = topology.objects.countries.geometries.filter(
    (geometry) => SELECTION[numericId(geometry)] !== undefined,
  );
  const missing = Object.keys(SELECTION).filter(
    (id) => !selected.some((geometry) => numericId(geometry) === id),
  );
  if (missing.length > 0) {
    throw new Error(`Source atlas is missing selected countries: ${missing.join(", ")}`);
  }

  // Pass 1: measure the pixel bbox of the fit window by sampling its edges
  // densely — a conic projection curves straight lon/lat edges, so corners
  // alone underestimate the frame (Malta would drop off the bottom edge).
  const { minLon, minLat, maxLon, maxLat } = FIT_LON_LAT;
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
    (CANVAS.width - pad * 2) / box.width,
    (CANVAS.height - pad * 2) / box.height,
  );
  const offX = (CANVAS.width - box.width * k) / 2;
  const offY = (CANVAS.height - box.height * k) / 2;
  const toPixel = ([lon, lat]) => {
    const [x, y] = project([lon, lat]);
    return [(x - box.minX) * k + offX, (y - box.minY) * k + offY];
  };

  const geometries = [];
  const features = [];
  for (const geometry of selected) {
    const meta = SELECTION[numericId(geometry)];
    const polygons = decodePolygons(geometry, arcAt)
      .map((polygon) =>
        polygon
          .map((ring) => ring.map(toPixel).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])))
          .filter((ring) => ring.length >= 4),
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

  // Seterra-style helper circles for the specks: the circle floats in open
  // water (hand-picked lon/lat) and the client draws a leader line to the
  // country, so it never covers other regions.
  const HELPERS = [
    { id: "MT", at: [14.75, 35.45] }, // Mediterranean, just off Malta
    { id: "LU", at: [3.8, 53.3] }, // open North Sea, clear of every coast
  ];
  const helpers = HELPERS.map(({ id, at }) => {
    const [x, y] = toPixel(at);
    return { id, anchor: { x: Math.round(x), y: Math.round(y) } };
  });

  const pack = {
    packId: PACK_ID,
    displayName: DISPLAY_NAME,
    projection: { kind: PROJECTION_KIND, width: CANVAS.width, height: CANVAS.height },
    source: {
      name: "world-atlas countries-50m.json (Natural Earth 1:50m)",
      url: "https://github.com/topojson/world-atlas",
      license: "Public domain (Natural Earth data)",
    },
    features,
    ...(helpers.length ? { helpers } : {}),
  };

  await mkdir(OUT_DIR, { recursive: true });
  const outTopology = {
    type: "Topology",
    objects: { countries: { type: "GeometryCollection", geometries } },
    arcs,
    transform: { scale: [1, 1], translate: [0, 0] },
  };
  await writeFile(path.join(OUT_DIR, "europe.topojson"), `${JSON.stringify(outTopology)}\n`);
  await writeFile(path.join(OUT_DIR, "europe.mappack.json"), `${JSON.stringify(pack, null, 2)}\n`);

  console.log(`Features: ${features.length}`);
  console.log(`Canvas: ${CANVAS.width}x${CANVAS.height}`);
  console.log(`Wrote ${OUT_DIR}/europe.topojson and europe.mappack.json`);
}

main().catch((error) => {
  console.error(`build-europe failed: ${error.message}`);
  process.exitCode = 1;
});
