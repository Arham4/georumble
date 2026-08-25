#!/usr/bin/env node
// Builds the world-landmarks MapPack: the data table in scripts/data/ turned
// into dot targets on the shared world frame via the POI builder, with the
// world's landmass as a faint underlay so the dots have geographic context.
import { buildPoiPack } from "./lib/poi-builder.mjs";
import { fetchLandParts } from "./lib/land-underlay.mjs";
import { LANDMARKS } from "./data/world-landmarks.mjs";

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
