#!/usr/bin/env node
// Builds the asia MapPack from world-atlas countries-50m via the shared
// continent builder. Reference implementation for the other continent packs.
import { buildContinentPack } from "./lib/continent-builder.mjs";

// Excluded from v1 (additive later under the same packId): Palestine
// (unstable source id).
const SELECTION = {
  "4": { iso2: "AF", name: "Afghanistan" },
  "51": { iso2: "AM", name: "Armenia" },
  "31": { iso2: "AZ", name: "Azerbaijan" },
  "50": { iso2: "BD", name: "Bangladesh" },
  "64": { iso2: "BT", name: "Bhutan" },
  "48": { iso2: "BH", name: "Bahrain" },
  "96": { iso2: "BN", name: "Brunei" },
  "116": { iso2: "KH", name: "Cambodia" },
  "156": { iso2: "CN", name: "China" },
  "196": { iso2: "CY", name: "Cyprus" },
  "268": { iso2: "GE", name: "Georgia" },
  "356": { iso2: "IN", name: "India" },
  "360": { iso2: "ID", name: "Indonesia" },
  "364": { iso2: "IR", name: "Iran" },
  "368": { iso2: "IQ", name: "Iraq" },
  "376": { iso2: "IL", name: "Israel" },
  "392": { iso2: "JP", name: "Japan" },
  "400": { iso2: "JO", name: "Jordan" },
  "398": { iso2: "KZ", name: "Kazakhstan" },
  "414": { iso2: "KW", name: "Kuwait" },
  "417": { iso2: "KG", name: "Kyrgyzstan" },
  "418": { iso2: "LA", name: "Laos" },
  "422": { iso2: "LB", name: "Lebanon" },
  "458": { iso2: "MY", name: "Malaysia" },
  "462": { iso2: "MV", name: "Maldives" },
  "702": { iso2: "SG", name: "Singapore" },
  "496": { iso2: "MN", name: "Mongolia" },
  "104": { iso2: "MM", name: "Myanmar", aliases: ["Burma"] },
  "524": { iso2: "NP", name: "Nepal" },
  "408": { iso2: "KP", name: "North Korea" },
  "512": { iso2: "OM", name: "Oman" },
  "586": { iso2: "PK", name: "Pakistan" },
  "608": { iso2: "PH", name: "Philippines" },
  "634": { iso2: "QA", name: "Qatar" },
  "643": { iso2: "RU", name: "Russia" },
  "682": { iso2: "SA", name: "Saudi Arabia" },
  "410": { iso2: "KR", name: "South Korea" },
  "144": { iso2: "LK", name: "Sri Lanka" },
  "760": { iso2: "SY", name: "Syria" },
  "158": { iso2: "TW", name: "Taiwan" },
  "762": { iso2: "TJ", name: "Tajikistan" },
  "764": { iso2: "TH", name: "Thailand" },
  "626": { iso2: "TL", name: "Timor-Leste", aliases: ["East Timor"] },
  "792": { iso2: "TR", name: "Turkey", aliases: ["Turkiye"] },
  "795": { iso2: "TM", name: "Turkmenistan" },
  "784": { iso2: "AE", name: "United Arab Emirates", aliases: ["UAE"] },
  "860": { iso2: "UZ", name: "Uzbekistan" },
  "704": { iso2: "VN", name: "Vietnam" },
  "887": { iso2: "YE", name: "Yemen" },
};

// Offshore helper anchors for the specks too small to click fairly.
const HELPERS = [
  { id: "BH", at: [50.8, 27.4] }, // Persian Gulf, north of Bahrain
  { id: "SG", at: [105.2, 0.2] }, // open sea between Singapore and Borneo
  { id: "MV", at: [70.5, -2.5] }, // Indian Ocean, southwest of the atolls
];

await buildContinentPack({
  packId: "asia",
  displayName: "Asia",
  // Mercator: the conic conformal squatted the continent into a wide strip,
  // while Mercator gives the familiar tall school-map Asia. Canvas matches
  // the window's Mercator aspect. maxLon runs to the antimeridian so all of
  // Russian Far East mainland is in frame; maxLat 78 keeps Novaya Zemlya and
  // drops the higher Arctic chains.
  projection: "mercator",
  canvas: { width: 1000, height: 905 },
  fit: { minLon: 25, minLat: -11, maxLon: 180, maxLat: 78 },
  // d3's rotate is the inverse angle: [-90] centers lon 90E.
  rotate: -90,
  selection: SELECTION,
  helpers: HELPERS,
});
