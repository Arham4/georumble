#!/usr/bin/env node
// Builds the oceania MapPack from world-atlas countries-50m via the shared
// continent builder. Mercator like asia; the window spans the antimeridian,
// which no other continent pack does.
//
// The fit window is written in negative-canonical longitude (west edge runs
// past -180 instead of east edge past +180) because the splitter reseats
// whole rings by multiples of 360 based on their mean: rings stored EAST of
// the antimeridian ship with negative longitudes in Natural Earth (Samoa,
// Tonga, Fr. Polynesia, most of Polynesia), and an unwrapped-positive window
// would leave them mirrored into the wrong half of the frame. Expressed this
// way every selected ring stays whole — nothing is cut at the window edges —
// and the projection's 360-periodicity places both sides correctly.
import { buildContinentPack } from "./lib/continent-builder.mjs";

const SELECTION = {
  "554": { iso2: "NZ", name: "New Zealand" },
  "598": { iso2: "PG", name: "Papua New Guinea" },
  "242": { iso2: "FJ", name: "Fiji" },
  "90": { iso2: "SB", name: "Solomon Islands", aliases: ["Solomon Is."] },
  "548": { iso2: "VU", name: "Vanuatu" },
  "882": { iso2: "WS", name: "Samoa" },
  "776": { iso2: "TO", name: "Tonga" },
  "296": { iso2: "KI", name: "Kiribati" },
  "583": { iso2: "FM", name: "Micronesia", aliases: ["Federated States of Micronesia"] },
  "584": { iso2: "MH", name: "Marshall Islands", aliases: ["Marshall Is."] },
  "585": { iso2: "PW", name: "Palau" },
  "520": { iso2: "NR", name: "Nauru" },
  "540": { iso2: "NC", name: "New Caledonia" },
  "258": { iso2: "PF", name: "French Polynesia" },
  "16": { iso2: "AS", name: "American Samoa" },
  "184": { iso2: "CK", name: "Cook Islands", aliases: ["Cook Is."] },
  "570": { iso2: "NU", name: "Niue" },
  "876": { iso2: "WF", name: "Wallis and Futuna", aliases: ["Wallis and Futuna Is."] },
  "316": { iso2: "GU", name: "Guam" },
  "580": { iso2: "MP", name: "Northern Mariana Islands", aliases: ["Northern Marianas", "N. Mariana Is."] },
  "612": { iso2: "PN", name: "Pitcairn", aliases: ["Pitcairn Is.", "Pitcairn Islands"] },
};

// Christmas Island and the Cocos (Keeling) Islands ship combined and without
// an ISO numeric id in the atlas, so they are reachable only by their atlas
// name. CX stands in as the feature id.
//
// Australia is also selected by name: the atlas ships TWO geometries under
// ISO numeric id 36 ("Australia" and "Ashmore and Cartier Is."), and picking
// the id selects both, violating the pack contract's unique-feature-id rule.
// The twin is a pair of uninhabited sub-pixel reefs, so dropping it is safe;
// selecting by name keeps the mainland whole.
const NAME_SELECTION = {
  Australia: { iso2: "AU", name: "Australia" },
  "Indian Ocean Ter.": {
    iso2: "CX",
    name: "Christmas and Cocos Islands",
    aliases: ["Christmas Island", "Cocos Islands", "Keeling Islands", "Indian Ocean Territories"],
  },
};

// Offshore helper anchors for the specks too small to click fairly; the
// client draws a leader line to the real region. Anchors use the same
// canonical longitudes the geometry renders at.
const HELPERS = [
  { id: "PW", at: [135.4, 7.0] }, // open Pacific east of Babeldaob
  { id: "NR", at: [165.9, -0.45] }, // open water west of Nauru, clear of Banaba
  { id: "KI", at: [174.2, -5.0] }, // open ocean south of the Gilberts' southern isles
  { id: "FM", at: [160.2, 8.4] }, // open water northeast of Pohnpei
  { id: "MH", at: [170.8, 5.4] }, // open water south of Majuro
  { id: "GU", at: [143.5, 12.1] }, // Philippine Sea southwest of Guam
  { id: "MP", at: [144.0, 17.4] }, // open water west of the Marianas chain
  { id: "CX", at: [101.2, -11.4] }, // open Indian Ocean between Cocos and Christmas
  { id: "WS", at: [-172.9, -11.6] }, // open water north of Savai'i
  { id: "AS", at: [-169.2, -15.6] }, // open water east of Tutuila
  { id: "WF", at: [-178.6, -12.2] }, // open water northwest of Futuna
  { id: "TO", at: [-176.3, -23.1] }, // open water southwest of Tongatapu
  { id: "NU", at: [-171.2, -20.9] }, // open water southwest of Niue
  { id: "CK", at: [-160.5, -20.8] }, // open water northwest of Rarotonga
  { id: "PF", at: [-150.5, -15.6] }, // open water north of the Society Islands
  { id: "PN", at: [-128.9, -24.9] }, // open water southwest of Pitcairn
];

await buildContinentPack({
  packId: "oceania",
  displayName: "Oceania",
  projection: "mercator",
  // Canvas matches the window's Mercator aspect at width 1000.
  canvas: { width: 1000, height: 651 },
  fit: { minLon: -264.5, minLat: -56, maxLon: -127, maxLat: 21 },
  // d3's rotate is the inverse angle: [+195.75] centers lon 164.25E, the
  // midpoint of Cocos (96.8E) to Pitcairn (232E unwrapped).
  rotate: 195.75,
  selection: SELECTION,
  nameSelection: NAME_SELECTION,
  helpers: HELPERS,
});
