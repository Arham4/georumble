/**
 * The single source of truth for shippable packs. The client renders this
 * list; the worker validates pack-vote ids against it, so a vote for an
 * unknown pack can never win the democratic roll and brick a lobby.
 */
export type PackGroup = "countries" | "usa" | "world";

export type PackDescriptor = {
  packId: string;
  displayName: string;
  blurb: string;
  /** Lobby picker section; new groups render automatically. */
  group: PackGroup;
  mappackUrl: string;
  topoUrl: string;
};

export const PACK_MANIFEST: PackDescriptor[] = [
  {
    packId: "us-states",
    displayName: "US States",
    blurb: "50 states plus DC on the classic albers map",
    group: "usa",
    mappackUrl: "/mappacks/us-states.mappack.json",
    topoUrl: "/mappacks/us-states.topojson",
  },
  {
    packId: "europe",
    displayName: "Europe",
    blurb: "47 countries from Portugal to Russia, microstates included",
    group: "countries",
    mappackUrl: "/mappacks/europe.mappack.json",
    topoUrl: "/mappacks/europe.topojson",
  },
  {
    packId: "asia",
    displayName: "Asia",
    blurb: "49 countries from the Mediterranean to the Pacific",
    group: "countries",
    mappackUrl: "/mappacks/asia.mappack.json",
    topoUrl: "/mappacks/asia.topojson",
  },
  {
    packId: "south-america",
    displayName: "South America",
    blurb: "12 countries from the Caribbean coast to Cape Horn",
    group: "countries",
    mappackUrl: "/mappacks/south-america.mappack.json",
    topoUrl: "/mappacks/south-america.topojson",
  },
  {
    packId: "africa",
    displayName: "Africa",
    blurb: "56 countries from the Maghreb to Madagascar",
    group: "countries",
    mappackUrl: "/mappacks/africa.mappack.json",
    topoUrl: "/mappacks/africa.topojson",
  },
  {
    packId: "north-america",
    displayName: "North America",
    blurb: "23 countries and Greenland, Arctic to Caribbean",
    group: "countries",
    mappackUrl: "/mappacks/north-america.mappack.json",
    topoUrl: "/mappacks/north-america.topojson",
  },
  {
    packId: "oceania",
    displayName: "Oceania",
    blurb: "23 islands and nations across the Pacific",
    group: "countries",
    mappackUrl: "/mappacks/oceania.mappack.json",
    topoUrl: "/mappacks/oceania.topojson",
  },
  {
    packId: "continents",
    displayName: "Continents",
    blurb: "The seven continents on one world map",
    group: "world",
    mappackUrl: "/mappacks/continents.mappack.json",
    topoUrl: "/mappacks/continents.topojson",
  },
  {
    packId: "oceans",
    displayName: "Oceans",
    blurb: "Five oceans on the same world frame",
    group: "world",
    mappackUrl: "/mappacks/oceans.mappack.json",
    topoUrl: "/mappacks/oceans.topojson",
  },
  {
    packId: "world-landmarks",
    displayName: "World Landmarks",
    blurb: "46 famous landmarks — click where they stand",
    group: "world",
    mappackUrl: "/mappacks/world-landmarks.mappack.json",
    topoUrl: "/mappacks/world-landmarks.topojson",
  },
  {
    packId: "eu4-great-projects",
    displayName: "Great Projects (EU4)",
    blurb: "Every EU4 monument — click its real-world site",
    group: "world",
    mappackUrl: "/mappacks/eu4-great-projects.mappack.json",
    topoUrl: "/mappacks/eu4-great-projects.topojson",
  },
];

export const PACK_IDS: readonly string[] = PACK_MANIFEST.map((pack) => pack.packId);
