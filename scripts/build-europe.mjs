#!/usr/bin/env node
// Builds the europe MapPack from world-atlas countries-50m via the shared
// continent builder. Rebuilt on the shared pipeline after v1's standalone
// script missed territories for three reasons: microstates were deliberately
// spared, Kosovo has no ISO numeric id (name-only in Natural Earth), and
// Montenegro was omitted from the hand-authored list.
import { buildContinentPack } from "./lib/continent-builder.mjs";

const SELECTION = {
  "8": { iso2: "AL", name: "Albania" },
  "20": { iso2: "AD", name: "Andorra" },
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
  "438": { iso2: "LI", name: "Liechtenstein" },
  "440": { iso2: "LT", name: "Lithuania" },
  "442": { iso2: "LU", name: "Luxembourg" },
  "470": { iso2: "MT", name: "Malta" },
  "492": { iso2: "MC", name: "Monaco" },
  "498": { iso2: "MD", name: "Moldova" },
  "499": { iso2: "ME", name: "Montenegro" },
  "528": { iso2: "NL", name: "Netherlands", aliases: ["Holland"] },
  "674": { iso2: "SM", name: "San Marino" },
  "807": { iso2: "MK", name: "North Macedonia", aliases: ["Macedonia"] },
  "578": { iso2: "NO", name: "Norway" },
  "616": { iso2: "PL", name: "Poland" },
  "620": { iso2: "PT", name: "Portugal" },
  "642": { iso2: "RO", name: "Romania" },
  "643": { iso2: "RU", name: "Russia" },
  "688": { iso2: "RS", name: "Serbia" },
  "336": { iso2: "VA", name: "Vatican City", aliases: ["Vatican", "Holy See"] },
  "703": { iso2: "SK", name: "Slovakia" },
  "705": { iso2: "SI", name: "Slovenia" },
  "724": { iso2: "ES", name: "Spain" },
  "752": { iso2: "SE", name: "Sweden" },
  "756": { iso2: "CH", name: "Switzerland" },
  "792": { iso2: "TR", name: "Turkey", aliases: ["Turkiye"] },
  "804": { iso2: "UA", name: "Ukraine" },
  "826": { iso2: "GB", name: "United Kingdom", aliases: ["UK", "Britain", "Great Britain"] },
};

// Kosovo carries no ISO 3166-1 numeric code (Natural Earth ships it as -99),
// so it is reachable only by its atlas name. XK is its de-facto ccTLD.
const NAME_SELECTION = {
  Kosovo: { iso2: "XK", name: "Kosovo" },
};

// Offshore helper anchors for the specks; the client draws a leader line to
// the real region, so the circles float in open water or open sky.
const HELPERS = [
  { id: "MT", at: [14.75, 35.45] }, // Mediterranean, just off Malta
  { id: "LU", at: [3.8, 53.3] }, // open North Sea, clear of every coast
  { id: "AD", at: [0.5, 41.3] }, // Mediterranean off Catalonia, north of the Balearics
  { id: "MC", at: [7.3, 43.1] }, // Mediterranean between Nice and Corsica
  { id: "SM", at: [12.3, 43.5] }, // Adriatic off Rimini
  { id: "VA", at: [11.5, 41.6] }, // Tyrrhenian Sea west of Rome
  { id: "LI", at: [9.55, 47.55] }, // Lake Constance, at the Swiss-Austrian shore
];

await buildContinentPack({
  packId: "europe",
  displayName: "Europe",
  canvas: { width: 1015, height: 640 },
  fit: { minLon: -26, minLat: 33, maxLon: 52, maxLat: 72 },
  parallels: [35, 65],
  rotate: -10,
  selection: SELECTION,
  nameSelection: NAME_SELECTION,
  // Natural Earth draws Crimea inside Russia's polygon (de facto control);
  // the quiz shows it with Ukraine (de jure, near-universally recognized).
  ringMoves: [
    {
      from: "RU",
      to: "UA",
      box: { minLon: 32.3, minLat: 44.2, maxLon: 36.8, maxLat: 46.3 },
    },
  ],
  helpers: HELPERS,
});
