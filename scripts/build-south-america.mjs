#!/usr/bin/env node
// Builds the south-america MapPack from world-atlas countries-50m via the
// shared continent builder. Reference implementation: build-asia.mjs.
import { buildContinentPack } from "./lib/continent-builder.mjs";

// French Guiana ships inside France in Natural Earth, so like every other
// pack it stays background here.
const SELECTION = {
  "32": { iso2: "AR", name: "Argentina" },
  "68": { iso2: "BO", name: "Bolivia" },
  "76": { iso2: "BR", name: "Brazil" },
  "152": { iso2: "CL", name: "Chile" },
  "170": { iso2: "CO", name: "Colombia" },
  "218": { iso2: "EC", name: "Ecuador" },
  "328": { iso2: "GY", name: "Guyana" },
  "600": { iso2: "PY", name: "Paraguay" },
  "604": { iso2: "PE", name: "Peru" },
  "740": { iso2: "SR", name: "Suriname" },
  "858": { iso2: "UY", name: "Uruguay" },
  "862": { iso2: "VE", name: "Venezuela" },
};

await buildContinentPack({
  packId: "south-america",
  displayName: "South America",
  canvas: { width: 1000, height: 1000 },
  // West edge reaches Rapa Nui (lon -109.44), which Natural Earth attaches to
  // Chile — anything shallower clips it mid-island.
  fit: { minLon: -111, minLat: -57, maxLon: -31, maxLat: 13 },
  parallels: [-10, -40],
  rotate: 60,
  selection: SELECTION,
});
