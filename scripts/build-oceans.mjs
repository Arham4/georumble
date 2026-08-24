#!/usr/bin/env node
// Builds the oceans MapPack: five hand-authored coarse polygons (2-4 degree
// resolution traced from geographic knowledge) on the same world frame as
// continents. V1 approach — coastlines deliberately approximate, land is NOT
// subtracted, so rings may slightly overlap or gap real coasts. All rings are
// outer-ring-only (renderer fills nonzero) and pre-split at the antimeridian;
// shared -60S edges between Atlantic/Indian/Pacific/Southern tile the south so
// every ocean click lands on exactly one feature.
import { buildWorldPack } from "./lib/world-builder.mjs";

const SOUTHERN_EDGE = -60;

// Antarctic coast traced eastward from the Ross Ice Shelf front (~78S at the
// seam) around the continent; the band between this line and 60S is Southern
// Ocean, so Antarctic land itself stays outside the feature.
const ANTARCTIC_COAST_WEST = [
  [-180, -78], [-160, -76], [-140, -74.5], [-120, -74], [-103, -74],
  [-90, -73], [-80, -73], [-72, -70], [-62, -64.5], [-58, -64], [-55, -65],
  [-45, -72], [-35, -76], [-25, -77], [-15, -75], [-10, -72], [0, -70],
];
const ANTARCTIC_COAST_EAST = [
  [180, -78], [170, -72], [160, -70], [150, -68.5], [140, -66.5], [130, -66],
  [120, -66.5], [110, -66], [100, -66], [90, -66.5], [78, -68.5], [70, -68],
  [60, -67], [50, -66.5], [40, -67], [30, -68.5], [20, -69.5], [10, -70],
  [0, -70],
];

// Northern coasts facing the Arctic, west-to-east along Eurasia then
// Greenland/Canada/Alaska east-to-west; capped by the frame's 85N edge.
const ARCTIC_EURASIA_WEST_TO_EAST = [
  [0, 64], [8, 67], [16, 69], [28, 71], [33, 69.5], [40, 68], [55, 69],
  [60, 70.5], [70, 72], [80, 73.5], [90, 76], [105, 77.5], [110, 76.5],
  [113, 75.5], [125, 73.5], [140, 72.5], [150, 71.5], [160, 70], [170, 69.5],
  [178, 68.8], [180, 68],
];
const ARCTIC_AMERICAS_EAST_TO_WEST = [
  [-180, 65.5], [-175, 65.8], [-168, 66.5], [-162, 68.5], [-156, 71.3],
  [-148, 70.5], [-141, 70], [-136, 69.5], [-128, 73], [-120, 78], [-118, 80],
  [-105, 81.5], [-95, 82.5], [-85, 83], [-76, 83.5], [-68, 83], [-58, 82],
  [-52, 80], [-45, 77], [-38, 74], [-30, 71.5], [-22, 70], [-24, 66.5],
  [-18, 65.5], [-8, 63.5], [0, 64],
];

// Americas west coast, south-to-north from Cape Horn to the Aleutians.
const AMERICAS_WEST_SOUTH_TO_NORTH = [
  [-67.3, -55.5], [-69, -52], [-73, -45], [-73.5, -37], [-71.5, -32],
  [-70, -23], [-70, -18], [-76, -14], [-81, -6], [-80.5, -1], [-78, 7],
  [-77.5, 8.5], [-83, 9.5], [-87, 13], [-93, 15.5], [-100, 17], [-105, 19.5],
  [-106, 23.5], [-110, 23], [-112, 26.5], [-114.5, 29.5], [-117.2, 32.8],
  [-122, 37], [-124, 41], [-124.5, 46], [-131, 53], [-137, 57.5], [-141, 59.8],
  [-146, 60.8], [-151, 59], [-154, 57.5], [-159, 55.5], [-164, 54.5],
  [-170, 52.8],
];

// Australia's Pacific-facing shores: Bass Strait up the east coast, around
// Cape York through the Gulf of Carpentaria to Darwin.
const AUSTRALIA_PACIFIC_SHORE = [
  [147, -39], [150, -37.5], [153, -33], [153, -27], [149, -21], [146, -19],
  [142, -11], [141.3, -13], [140, -17.5], [137, -15.8], [136, -12],
  [132, -11],
];

// One smooth offshore pass west and then north from Darwin through the
// archipelago seas, the South China Sea, China, Korea, Japan, and the Okhotsk
// shore to the Bering — straits are not threaded; islands inside this sweep
// fall to whichever ocean polygon overlaps them.
const ASIA_PACIFIC_NORTH_FROM_DARWIN = [
  [132, -11], [128, -10.8], [122, -9.5], [117, -8.5], [112, -6.5],
  [106.5, -5.5], [104.5, -0.5], [108, 6], [107, 16.5], [106, 20.5],
  [110, 21], [113.5, 22.5], [117, 24], [121, 28], [122, 31], [120.5, 34],
  [121, 37.5], [122, 39.5], [121, 40.8], [124, 39.8], [126.5, 37.5],
  [129, 35.5], [129.8, 40], [131, 43], [135, 44.5], [138.5, 47], [141, 51],
  [141.5, 53.5], [138, 54], [135, 56.5], [137, 58.5], [147, 59.5],
  [151, 59.3], [155, 57], [157, 55], [156.7, 50.9], [160, 53.5], [163, 56],
  [166, 60], [170, 60.5], [176, 62.5],
];

// Africa's Atlantic-facing coast and Iberia/France up to Skagen (northbound),
// pinching the Mediterranean off at Gibraltar.
const ATLANTIC_SHORE_AFRICA_EUROPE = [
  [20, -35], [18, -32.5], [14.5, -26], [12, -18], [13.5, -12], [9, -1],
  [9.5, 4], [4, 6], [-2, 5], [-8, 4.5], [-13, 8.5], [-17, 14.5], [-16, 21],
  [-13, 27], [-9.8, 30], [-6.3, 36.1], [-9, 37], [-9, 39], [-9, 43.5],
  [-2, 43.5], [-1, 46], [-4.8, 48.4], [0, 49.8], [2.5, 51.2], [4.5, 52.7],
  [7, 53.5], [8, 55.5], [8, 57.5],
];

// A coarse open-ocean north edge past Britain and Iceland to Greenland.
const ATLANTIC_EAST_NORTH_TO_SOUTH = [
  [8, 57.5], [2, 58], [-5, 58.5], [-10, 55], [-10, 52], [-14, 58],
  [-19, 66], [-24, 64], [-33, 66], [-40, 62], [-43.5, 59.8], [-49, 62],
  [-52, 64], [-55, 66],
];

// Labrador/New England shore south to Florida, then around the Gulf and the
// Caribbean to Trinidad and the Guianas.
const ATLANTIC_WEST_NORTH_TO_SOUTH = [
  [-55, 66], [-56, 54], [-55, 52], [-60, 50], [-64, 49], [-60, 47],
  [-66, 44], [-70, 42], [-74, 39], [-76, 35], [-81, 31], [-80, 25.5],
  [-82, 27], [-84, 30], [-89, 29.5], [-94, 29.5], [-97, 26], [-87, 21.5],
  [-86.5, 17], [-83, 15], [-83, 11], [-79, 9], [-75, 10.5], [-71, 12],
  [-61, 11], [-52, 5], [-50, 0], [-44, -3], [-38, -5], [-35, -8], [-39, -14],
  [-41, -22], [-48, -26], [-53, -34], [-57, -38], [-62, -40], [-65, -45],
  [-68, -50], [-68, -60],
];

// Africa/Arabia/Asia shore bounding the Indian Ocean on the northwest,
// west-to-east: Cape Agulhas up the east African coast, a pinch at Bab el
// Mandeb excluding the Red Sea, one loop around the Persian Gulf (in along
// Iran, out along Arabia), then India and the Bay of Bengal.
const INDIAN_SHORE_AFRICA_ARABIA = [
  [20, -35], [27, -33.5], [31, -29.5], [33, -26], [35, -24], [40, -16.5],
  [39, -10], [40, -7], [44, 1], [48, 5], [48, 7], [51.2, 11.8], [48, 14],
  [45, 13.2], [43.3, 12.6], [45, 13], [50, 15], [54, 17], [57, 20],
  [58.8, 23.6], [56.3, 24.8], [55, 24], [51.5, 24.5], [50, 26.5], [48, 29.8],
  [51, 28], [54, 26.8], [56.7, 27], [58.5, 25.5], [61, 25.2], [66, 25],
];

// Bay of Bengal through the archipelago: Malacca and the Sumatra/Java/Timor
// southern shores face the Indian, then the Timor Sea leads to Australia.
const INDIAN_SHORE_ASIA = [
  [70, 22.5], [72.8, 19], [74, 15], [77.2, 8.2], [80.3, 13.5], [82, 17],
  [86.5, 20], [88, 21.8], [91, 22], [92.3, 20.7], [94, 16], [97.5, 15.5],
  [98.3, 10], [100, 6], [102, 2], [104, 1.3], [103.5, 0], [104.5, -3],
  [105.8, -5.9], [107.5, -7.6], [111, -8.4], [115, -9], [119, -9.5],
  [124, -10.5], [128, -11], [130, -12.3],
];

// Australia's Indian-facing shores: NW coast south to the SW tip, then the
// entire south coast east to Bass Strait, where the Pacific takes over.
const INDIAN_SHORE_AUSTRALIA = [
  [127, -14], [122, -18], [117, -21], [114, -26], [113.5, -32], [115, -34.5],
  [118, -35], [124, -33], [129, -31.7], [132, -32], [134, -33.5], [137, -35.2],
  [139.5, -37.2], [143.5, -38.7], [146.5, -39.5], [147, -42], [147.5, -48],
  [147.5, SOUTHERN_EDGE],
];

const FEATURES = [
  {
    id: "PA",
    name: "Pacific Ocean",
    rings: [
      // East of the Americas, closed west along the antimeridian. Every
      // longitude stays inside one [-180, -68] window so the seam corners
      // render on the left edge instead of streaking across the canvas.
      [[-180, 65], [-180, SOUTHERN_EDGE], [-120, SOUTHERN_EDGE], [-68, SOUTHERN_EDGE],
        ...AMERICAS_WEST_SOUTH_TO_NORTH, [-180, 52]],
      // West of Asia/Australia, closed east along the antimeridian; shares
      // its Bass Strait edge with the Indian in reverse.
      [[180, 65], [180, SOUTHERN_EDGE], [147.5, SOUTHERN_EDGE],
        ...AUSTRALIA_PACIFIC_SHORE, ...ASIA_PACIFIC_NORTH_FROM_DARWIN.slice(1),
        [180, 65]],
    ],
  },
  {
    id: "AT",
    name: "Atlantic Ocean",
    // One ring, no antimeridian contact: bounded south at 60S between Cape
    // Horn (67W) and Africa (20E), including the Gulf and the Caribbean.
    rings: [
      [[-68, SOUTHERN_EDGE], [-40, SOUTHERN_EDGE], [0, SOUTHERN_EDGE], [20, SOUTHERN_EDGE],
        ...ATLANTIC_SHORE_AFRICA_EUROPE, ...ATLANTIC_EAST_NORTH_TO_SOUTH.slice(1),
        ...ATLANTIC_WEST_NORTH_TO_SOUTH],
    ],
  },
  {
    id: "IN",
    name: "Indian Ocean",
    rings: [
      [[20, -35], [20, SOUTHERN_EDGE], [60, SOUTHERN_EDGE], [100, SOUTHERN_EDGE],
        [115, SOUTHERN_EDGE], [147.5, SOUTHERN_EDGE], [147.5, -48], [147, -42],
        ...INDIAN_SHORE_AUSTRALIA.slice().reverse(),
        ...INDIAN_SHORE_ASIA.slice().reverse(),
        ...INDIAN_SHORE_AFRICA_ARABIA.slice().reverse()],
    ],
  },
  {
    id: "AR",
    name: "Arctic Ocean",
    rings: [
      // Eurasian side, closed along the 85N frame edge.
      [[0, 85], [180, 85], [180, 68], ...ARCTIC_EURASIA_WEST_TO_EAST.slice(0, -1).reverse()],
      // Greenland/Canadian/Alaskan side, likewise capped at 85N: down
      // meridian 0, west along the coast, closed by the seam edge.
      [[-180, 85], [0, 85], ...ARCTIC_AMERICAS_EAST_TO_WEST.slice().reverse()],
    ],
  },
  {
    id: "SO",
    name: "Southern Ocean",
    rings: [
      // Everything south of 60S except Antarctic land: the band between the
      // traced coast and 60S, halved at lon 0 and closed on the seams.
      [[-180, SOUTHERN_EDGE], [0, SOUTHERN_EDGE], [0, -70], ...ANTARCTIC_COAST_WEST.slice(1).reverse()],
      [[0, SOUTHERN_EDGE], [180, SOUTHERN_EDGE], ...ANTARCTIC_COAST_EAST.slice(1)],
    ],
  },
];

await buildWorldPack({
  packId: "oceans",
  displayName: "Oceans",
  source: {
    name: "Hand-authored coarse coastline rings (v1)",
    license: "Original approximation, no third-party data",
  },
  features: FEATURES.map(({ rings, ...meta }) => ({
    ...meta,
    parts: rings.map((ring) => [ring]),
  })),
});
console.log(FEATURES.map((f) => `${f.id}: ${f.rings.reduce((n, r) => n + r.length, 0)}pts`).join(", "));
