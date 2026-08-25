#!/usr/bin/env node
// Builds the eu4-great-projects MapPack: EU4's Great Project monuments turned
// into dot targets on the shared world frame via the POI builder, with the
// world's landmass as a faint underlay — same recipe as world-landmarks.
import { buildPoiPack } from "./lib/poi-builder.mjs";
import { fetchLandParts } from "./lib/land-underlay.mjs";
import { GREAT_PROJECTS } from "./data/eu4-great-projects.mjs";

await buildPoiPack({
  packId: "eu4-great-projects",
  displayName: "Great Projects (EU4)",
  source: {
    name: "Monument list from eu4.paradoxwikis.com (EU4 Leviathan great projects); coordinates hand-authored; land underlay from world-atlas land-110m (Natural Earth, public domain)",
    license: "Original data; underlay public domain (Natural Earth)",
  },
  points: GREAT_PROJECTS,
  // 141 dots cluster tightly (Europe alone holds 48 within a few degrees of
  // its neighbors); zoom scales dots and spacing equally, so a small radius
  // is the only way to keep neighbors separable.
  radiusDegrees: 1.2,
  background: await fetchLandParts(),
});
