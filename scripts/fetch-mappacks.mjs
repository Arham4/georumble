#!/usr/bin/env node
// Downloads public-domain us-atlas TopoJSON and derives a contract-shaped MapPack
// (see docs/mappack-contract.md). Zero dependencies: runs with plain `node`.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bounds,
  decodeArcs,
  mainRingCentroid,
  ringPoints,
} from "./lib/topo-utils.mjs";

const PACK_ID = "us-states";
const DISPLAY_NAME = "US States";
const PROJECTION_KIND = "albers-usa-preprojected";
const OUT_DIR = path.resolve(import.meta.dirname, "../assets/mappacks");

const SOURCES = [
  "https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json",
  "https://unpkg.com/us-atlas@3/states-albers-10m.json",
];

// FIPS -> USPS code, used as a typed-answer alias. Keys absent from the atlas are ignored.
const POSTAL_BY_FIPS = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "72": "PR",
};

const EXTRA_ALIASES = {
  // Aliases must stay distinct after game-side normalization (punctuation stripped), so
  // "Washington D.C." would duplicate "Washington DC"; bare "Washington" would collide
  // with the state of Washington.
  "11": ["Washington DC"],
};

async function fetchTopology() {
  const failures = [];
  for (const url of SOURCES) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const topology = await response.json();
      if (!topology?.objects?.states?.geometries) throw new Error("not a states TopoJSON");
      console.log(`Downloaded ${url}`);
      return topology;
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`All sources failed:\n  ${failures.join("\n  ")}`);
}

function buildPack(topology) {
  const geometries = topology.objects.states.geometries;
  const arcAt = decodeArcs(topology);
  const seenIds = new Set();

  const features = geometries.map((geometry) => {
    const id = String(geometry.id);
    if (!id || seenIds.has(id)) throw new Error(`Missing or duplicate feature id: "${id}"`);
    seenIds.add(id);

    const name = geometry.properties?.name;
    if (!name) throw new Error(`Feature ${id} has no name`);

    const aliases = [POSTAL_BY_FIPS[id], ...(EXTRA_ALIASES[id] ?? [])].filter(Boolean);
    const centroid = mainRingCentroid(topology, geometry, arcAt);

    const feature = { id, name };
    if (aliases.length) feature.aliases = aliases;
    if (centroid) feature.centroidHint = { x: Math.round(centroid.x), y: Math.round(centroid.y) };
    return feature;
  });

  features.sort((a, b) => a.name.localeCompare(b.name));
  const { width, height } = bounds(topology, geometries, arcAt);

  return {
    packId: PACK_ID,
    displayName: DISPLAY_NAME,
    projection: { kind: PROJECTION_KIND, width, height },
    source: {
      name: "us-atlas states-albers-10m.json",
      url: "https://github.com/topojson/us-atlas",
      license: "Public domain (US Census Bureau cartographic boundary data)",
    },
    features,
  };
}

async function main() {
  const topology = await fetchTopology();
  const geometries = topology.objects.states.geometries;

  const pack = buildPack(topology);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "us-states.topojson"), `${JSON.stringify(topology)}\n`);
  await writeFile(path.join(OUT_DIR, "us-states.mappack.json"), `${JSON.stringify(pack, null, 2)}\n`);

  console.log(`Feature count: ${geometries.length}`);
  console.log(`Named features: ${pack.features.length}`);
  console.log(`Projection canvas: ${pack.projection.width}x${pack.projection.height}`);
  console.log(`Wrote ${OUT_DIR}/us-states.topojson and us-states.mappack.json`);
}

main().catch((error) => {
  console.error(`fetch-mappacks failed: ${error.message}`);
  process.exitCode = 1;
});
