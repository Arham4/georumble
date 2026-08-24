#!/usr/bin/env node
// Builds the continents MapPack: every country of world-atlas countries-50m
// assigned to exactly one of seven continental features on one shared world
// frame. The coverage assertion below is the correctness net — an unassigned
// atlas geometry fails the build instead of silently vanishing from a map.
import { decodeArcs, ringPoints } from "./lib/topo-utils.mjs";
import { buildWorldPack, fetchWorldTopology } from "./lib/world-builder.mjs";

// Membership keyed by world-atlas numeric id (decimal string, no leading
// zeros). Conventions, chosen once and applied uniformly:
//   Russia -> Europe (matches the shipped europe pack); Turkey, Cyprus and the
//   Caucasus states -> Asia; Egypt -> Africa; Panama plus ALL Caribbean
//   islands and Greenland -> North America; Trinidad & Tobago -> North America
//   by convention despite its southern position; Falkland Islands -> South
//   America; Timor-Leste -> Asia (matches the shipped asia pack); Pacific
//   islands incl. New Caledonia / French Polynesia -> Oceania; French Southern
//   & Antarctic Lands, Heard, South Georgia -> Antarctica; Hawai'i stays with
//   the US in North America (same geometry). France's overseas departments
//   ship inside its single atlas geometry and therefore land in Europe.
const MEMBERS = {
  AF: [
    "12", "24", "72", "86", "108", "120", "132", "140", "148", "174", "178",
    "180", "204", "226", "231", "232", "262", "266", "270", "288", "324", "384",
    "404", "426", "430", "434", "450", "454", "466", "478", "480", "504", "508",
    "516", "562", "566", "624", "646", "654", "678", "686", "690", "694", "706",
    "710", "716", "728", "729", "732", "748", "768", "788", "800", "818", "834",
    "854", "894",
  ],
  AN: ["10", "239", "260", "334"],
  AS: [
    "4", "31", "48", "50", "51", "64", "96", "104", "116", "144", "156", "158",
    "196", "268", "275", "344", "356", "360", "364", "368", "376", "392", "398",
    "400", "408", "410", "414", "417", "418", "422", "446", "458", "462", "496",
    "512", "524", "586", "608", "626", "634", "643", "682", "702", "704", "760",
    "762", "764", "784", "792", "795", "860", "887",
  ],
  EU: [
    "8", "20", "40", "56", "70", "100", "112", "191", "203", "208", "233",
    "234", "246", "248", "250", "276", "300", "336", "348", "352", "372", "380",
    "428", "438", "440", "442", "470", "492", "498", "499", "528", "578", "616",
    "620", "642", "674", "688", "703", "705", "724", "752", "756", "804", "807",
    "826", "831", "832", "833",
  ],
  NA: [
    "28", "44", "52", "60", "84", "92", "124", "136", "188", "192", "212",
    "214", "222", "304", "308", "320", "332", "340", "388", "484", "500", "531",
    "533", "534", "558", "591", "630", "652", "659", "660", "662", "663", "666",
    "670", "780", "796", "840", "850",
  ],
  OC: [
    "16", "36", "90", "184", "242", "258", "296", "316", "520", "540", "548",
    "554", "570", "574", "580", "583", "584", "585", "598", "612", "776", "882",
    "876",
  ],
  SA: ["32", "68", "76", "152", "170", "218", "238", "328", "600", "604", "740", "858", "862"],
};

// Five atlas geometries carry no usable id (Natural Earth "-99" cases), so
// they are matched by name instead.
const MEMBER_BY_NAME = {
  "Somaliland": "AF",
  "Kosovo": "EU",
  "N. Cyprus": "AS",
  "Indian Ocean Ter.": "OC",
  "Siachen Glacier": "AS",
};

const FEATURES = [
  { id: "AF", name: "Africa" },
  { id: "AN", name: "Antarctica" },
  { id: "AS", name: "Asia" },
  { id: "EU", name: "Europe" },
  { id: "NA", name: "North America" },
  { id: "OC", name: "Oceania", aliases: ["Australia"] },
  { id: "SA", name: "South America" },
];

const numericId = (geometry) => String(Number(String(geometry.id)));

const topology = await fetchWorldTopology();
const continentOf = new Map();
for (const [continent, ids] of Object.entries(MEMBERS)) {
  for (const id of ids) {
    if (continentOf.has(id)) throw new Error(`Atlas id ${id} assigned twice`);
    continentOf.set(id, continent);
  }
}

const leftovers = [];
for (const geometry of topology.objects.countries.geometries) {
  const key = String(geometry.id) === "undefined" ? null : numericId(geometry);
  const continent =
    (key ? continentOf.get(key) : undefined) ?? MEMBER_BY_NAME[geometry.properties?.name];
  if (!continent) leftovers.push(`${key ?? "(no id)"} ${geometry.properties?.name}`);
  else geometry.__continent = continent;
}
if (leftovers.length > 0) {
  throw new Error(`Unassigned geometries — extend MEMBERS/MEMBER_BY_NAME:\n  ${leftovers.join("\n  ")}`);
}
const atlasIds = new Set(topology.objects.countries.geometries.map(numericId));
const phantom = [...continentOf.keys()].filter((id) => !atlasIds.has(id));
if (phantom.length > 0) {
  throw new Error(`MEMBERS lists ids absent from the atlas: ${phantom.join(", ")}`);
}

const arcAt = decodeArcs(topology);
const partsByContinent = new Map(FEATURES.map((feature) => [feature.id, []]));
for (const geometry of topology.objects.countries.geometries) {
  // Outer rings only: enclaves (Lesotho, San Marino, Vatican) render as their
  // own features on top, and holes would fight the renderer's nonzero fill.
  const polygons =
    geometry.type === "Polygon" ? [geometry.arcs]
    : geometry.type === "MultiPolygon" ? geometry.arcs
    : [];
  for (const polygon of polygons) {
    partsByContinent.get(geometry.__continent).push([ringPoints(polygon[0], arcAt)]);
  }
}

await buildWorldPack({
  packId: "continents",
  displayName: "Continents",
  source: {
    name: "world-atlas countries-50m.json (Natural Earth 1:50m)",
    url: "https://github.com/topojson/world-atlas",
    license: "Public domain (Natural Earth data)",
  },
  features: FEATURES.map((feature) => ({
    ...feature,
    parts: partsByContinent.get(feature.id),
  })),
});
console.log(
  Object.entries(MEMBERS)
    .map(([id, ids]) => `${id}: ${ids.length + Object.values(MEMBER_BY_NAME).filter((c) => c === id).length}`)
    .join(", "),
);
