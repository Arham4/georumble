#!/usr/bin/env node
// Builds the world-landmarks MapPack: the data table in scripts/data/ turned
// into dot targets on the shared world frame via the POI builder.
import { buildPoiPack } from "./lib/poi-builder.mjs";
import { LANDMARKS } from "./data/world-landmarks.mjs";

await buildPoiPack({
  packId: "world-landmarks",
  displayName: "World Landmarks",
  source: {
    name: "Hand-authored landmark coordinates",
    license: "Original data",
  },
  points: LANDMARKS,
});
