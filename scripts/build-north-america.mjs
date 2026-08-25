#!/usr/bin/env node
// Builds the north-america MapPack from world-atlas countries-50m via the shared
// continent builder. Sovereign nations plus Greenland only — territories
// (Puerto Rico, Cayman, Bermuda, ...) stay out of v1 and can join additively.
import { buildContinentPack } from "./lib/continent-builder.mjs";

const SELECTION = {
  "28": { iso2: "AG", name: "Antigua and Barbuda" },
  "44": { iso2: "BS", name: "Bahamas" },
  "52": { iso2: "BB", name: "Barbados" },
  "84": { iso2: "BZ", name: "Belize" },
  "124": { iso2: "CA", name: "Canada" },
  "188": { iso2: "CR", name: "Costa Rica" },
  "192": { iso2: "CU", name: "Cuba" },
  "212": { iso2: "DM", name: "Dominica" },
  "214": { iso2: "DO", name: "Dominican Republic" },
  "222": { iso2: "SV", name: "El Salvador" },
  "304": { iso2: "GL", name: "Greenland" },
  "308": { iso2: "GD", name: "Grenada" },
  "320": { iso2: "GT", name: "Guatemala" },
  "332": { iso2: "HT", name: "Haiti" },
  "340": { iso2: "HN", name: "Honduras" },
  "388": { iso2: "JM", name: "Jamaica" },
  "484": { iso2: "MX", name: "Mexico" },
  "558": { iso2: "NI", name: "Nicaragua" },
  "591": { iso2: "PA", name: "Panama" },
  "659": { iso2: "KN", name: "Saint Kitts and Nevis" },
  "662": { iso2: "LC", name: "Saint Lucia" },
  "670": { iso2: "VC", name: "Saint Vincent and the Grenadines" },
  "780": { iso2: "TT", name: "Trinidad and Tobago" },
  "840": {
    iso2: "US",
    name: "United States of America",
    aliases: ["USA", "US", "America", "United States"],
  },
};

// Offshore helper anchors for the Lesser Antilles specks; the client draws a
// leader line to the real region, so the circles float in open water without
// covering another target.
const HELPERS = [
  { id: "KN", at: [-63.8, 18.5] }, // Atlantic in the Anegada Passage, north of St Kitts
  { id: "AG", at: [-60.5, 17.0] }, // Atlantic east of Antigua
  { id: "DM", at: [-63.9, 15.7] }, // Caribbean west of Dominica
  { id: "LC", at: [-62.6, 14.3] }, // Caribbean west of St Lucia
  { id: "VC", at: [-63.2, 12.7] }, // Caribbean west of St Vincent
  { id: "GD", at: [-65.3, 11.8] }, // open Caribbean, clear of Grenada and Venezuela
  { id: "BB", at: [-57.8, 12.3] }, // open Atlantic southeast of Barbados
  { id: "TT", at: [-62.5, 9.8] }, // Atlantic off Trinidad's north coast, clear of Venezuela
  { id: "JM", at: [-76.2, 19.5] }, // Atlantic north of Jamaica, clear of Cuba
];

await buildContinentPack({
  packId: "north-america",
  displayName: "North America",
  // Conic conformal centered on 100W spans the Aleutians to Greenland. The fit
  // window cuts at -172 so the window split drops the Aleutian islands lying
  // past the dateline while keeping the rest of Alaska; maxLon -10 pads past
  // Greenland's east coast, maxLat 84 past its northernmost point.
  canvas: { width: 1000, height: 584 },
  fit: { minLon: -172, minLat: 6, maxLon: -10, maxLat: 84 },
  parallels: [20, 60],
  rotate: 100,
  selection: SELECTION,
  helpers: HELPERS,
});
