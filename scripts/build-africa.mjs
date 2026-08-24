#!/usr/bin/env node
// Builds the africa MapPack from world-atlas countries-50m via the shared
// continent builder.
import { buildContinentPack } from "./lib/continent-builder.mjs";

// Excluded from v1 (additive later under the same packId): Western Sahara
// (disputed territory; the atlas folds its land into Morocco's polygon).
const SELECTION = {
  "12": { iso2: "DZ", name: "Algeria" },
  "24": { iso2: "AO", name: "Angola" },
  "204": { iso2: "BJ", name: "Benin" },
  "72": { iso2: "BW", name: "Botswana" },
  "854": { iso2: "BF", name: "Burkina Faso" },
  "108": { iso2: "BI", name: "Burundi" },
  "132": { iso2: "CV", name: "Cabo Verde", aliases: ["Cape Verde"] },
  "120": { iso2: "CM", name: "Cameroon" },
  "140": { iso2: "CF", name: "Central African Republic" },
  "148": { iso2: "TD", name: "Chad" },
  "174": { iso2: "KM", name: "Comoros" },
  "180": {
    iso2: "CD",
    name: "Democratic Republic of the Congo",
    aliases: ["DR Congo", "Congo-Kinshasa"],
  },
  "262": { iso2: "DJ", name: "Djibouti" },
  "818": { iso2: "EG", name: "Egypt" },
  "226": { iso2: "GQ", name: "Equatorial Guinea" },
  "232": { iso2: "ER", name: "Eritrea" },
  "748": { iso2: "SZ", name: "Eswatini", aliases: ["Swaziland"] },
  "231": { iso2: "ET", name: "Ethiopia" },
  "266": { iso2: "GA", name: "Gabon" },
  "270": { iso2: "GM", name: "Gambia" },
  "288": { iso2: "GH", name: "Ghana" },
  "324": { iso2: "GN", name: "Guinea" },
  "624": { iso2: "GW", name: "Guinea-Bissau" },
  "384": { iso2: "CI", name: "Côte d'Ivoire", aliases: ["Ivory Coast"] },
  "404": { iso2: "KE", name: "Kenya" },
  "426": { iso2: "LS", name: "Lesotho" },
  "430": { iso2: "LR", name: "Liberia" },
  "434": { iso2: "LY", name: "Libya" },
  "450": { iso2: "MG", name: "Madagascar" },
  "454": { iso2: "MW", name: "Malawi" },
  "466": { iso2: "ML", name: "Mali" },
  "478": { iso2: "MR", name: "Mauritania" },
  "480": { iso2: "MU", name: "Mauritius" },
  "504": { iso2: "MA", name: "Morocco" },
  "508": { iso2: "MZ", name: "Mozambique" },
  "516": { iso2: "NA", name: "Namibia" },
  "562": { iso2: "NE", name: "Niger" },
  "566": { iso2: "NG", name: "Nigeria" },
  "646": { iso2: "RW", name: "Rwanda" },
  "178": { iso2: "CG", name: "Republic of the Congo", aliases: ["Congo-Brazzaville"] },
  "678": {
    iso2: "ST",
    name: "São Tomé and Príncipe",
    aliases: ["Sao Tome and Principe"],
  },
  "686": { iso2: "SN", name: "Senegal" },
  "690": { iso2: "SC", name: "Seychelles" },
  "694": { iso2: "SL", name: "Sierra Leone" },
  "706": { iso2: "SO", name: "Somalia" },
  "710": { iso2: "ZA", name: "South Africa" },
  "728": { iso2: "SS", name: "South Sudan" },
  "729": { iso2: "SD", name: "Sudan" },
  "834": { iso2: "TZ", name: "Tanzania" },
  "768": { iso2: "TG", name: "Togo" },
  "788": { iso2: "TN", name: "Tunisia" },
  "800": { iso2: "UG", name: "Uganda" },
  "894": { iso2: "ZM", name: "Zambia" },
  "716": { iso2: "ZW", name: "Zimbabwe" },
};

// Offshore helper anchors for the specks too small to click fairly.
const HELPERS = [
  { id: "CV", at: [-26.5, 13.8] }, // Atlantic, southwest of the archipelago
  { id: "ST", at: [4.8, -1.5] }, // Gulf of Guinea open water, off São Tomé
  { id: "KM", at: [46.8, -13.8] }, // Mozambique Channel, off the islands
  { id: "MU", at: [57.5, -21.8] }, // Indian Ocean, due south of the island
  { id: "SC", at: [53.5, -2.5] }, // Indian Ocean, northwest of Mahé
];

await buildContinentPack({
  packId: "africa",
  displayName: "Africa",
  canvas: { width: 960, height: 1000 },
  // The atlas gives South Africa the sub-Antarctic Prince Edward Islands
  // (lat -46.9); keeping minLat at the mainland floor clips them off-frame
  // like the europe pack does with outliers, instead of shrinking the
  // continent to fit an empty ocean band.
  fit: { minLon: -30, minLat: -37, maxLon: 62, maxLat: 38.5 },
  parallels: [-20, 20],
  rotate: 20,
  selection: SELECTION,
  helpers: HELPERS,
});
