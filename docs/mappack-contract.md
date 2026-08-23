# MapPack Contract

A **MapPack** is pure data: the set of clickable regions for one map quiz. It carries no
behavior and no rendering code — the client renders geometry from the companion TopoJSON
file and joins it to pack metadata by feature `id`.

Protocol tie-in (`shared/protocol.ts`): `RoomSnapshot.packId` selects the pack,
`GuessOutcome.featureId` / `{ t: "guess" }` carry `MapFeature.id` values verbatim.

## Artifacts

| File | Role |
| --- | --- |
| `assets/mappacks/us-states.topojson` | Raw TopoJSON geometry (`objects.states`), pre-projected with d3 `geoAlbersUsa`. Render source; committed. |
| `assets/mappacks/us-states.mappack.json` | Contract-shaped metadata pack derived by `scripts/fetch-mappacks.mjs`. |
| `assets/mappacks/europe.topojson` | European countries pre-projected with a conic conformal projection, built by `scripts/build-europe.mjs`. |
| `assets/mappacks/europe.mappack.json` | Europe metadata pack (39 countries, ISO alpha-2 ids). |
| `scripts/fetch-mappacks.mjs` | Downloads us-atlas, writes the us-states files above. |
| `scripts/build-europe.mjs` | Downloads world-atlas, selects and pre-projects Europe, writes the europe files above. |
| `scripts/lib/topo-utils.mjs` | TopoJSON decode/centroid/bounds/encode math shared by every builder. |
| `scripts/validate-mappack.mjs` | Checks any `*.mappack.json` against this contract; nonzero exit on violation. |

## Type definitions

These are the exact types the future `shared/mappack.ts` should declare:

```ts
export type ProjectionKind =
  | "albers-usa-preprojected"
  | "conic-conformal-preprojected"
  | "equirectangular-geo";

export type CentroidHint = {
  x: number;
  y: number;
};

export type MapFeature = {
  /** Stable across versions. For US states: the us-atlas / Census FIPS code ("01", "11", ...). */
  id: string;
  /** Canonical display name shown to players. */
  name: string;
  /** Extra acceptable typed answers (postal codes, common spellings). Optional. */
  aliases?: string[];
  /** A good zoom/pan target, in the pack's projected coordinate space. Optional. */
  centroidHint?: CentroidHint;
};

export type PackSource = {
  name: string;
  url?: string;
  license: string;
};

export type Projection = {
  kind: ProjectionKind;
  width: number;
  height: number;
};

export type MapPack = {
  /** Lowercase kebab-case, immutable once shipped (rooms reference it). */
  packId: string;
  displayName: string;
  projection: Projection;
  source: PackSource;
  features: MapFeature[];
};
```

## Field semantics

- **`projection.kind`** — `"albers-usa-preprojected"` and `"conic-conformal-preprojected"` mean
  coordinates (TopoJSON arcs and `centroidHint`) are already projected pixels inside a
  `width`×`height` canvas; render with `d3.geoIdentity().fitExtent(...)`, no reprojection needed.
  The kind string documents which projection produced the pixels. `"equirectangular-geo"` means
  coordinates are lon/lat degrees and `centroidHint` is `{ x: lon, y: lat }`.
- **`id`** — the join key to TopoJSON geometries and the value sent as `featureId` on the wire.
  Never renumber; new packs should adopt their source atlas's native id convention.
- **`name`** — canonical player-facing answer. Unique within a pack (see validation).
- **`aliases`** — accepted alternate answers only. Matching is exact after normalization;
  prefix/partial matching is forbidden because it makes "Virginia" ambiguous against
  "West Virginia".
- **Answer normalization (game-side guidance)**: trim, lowercase, strip diacritics and
  punctuation (`.` `,` `-`), then compare against `name` plus every `alias`,
  case-insensitively. Normalization lives in game code, not in the pack.

## Validation rules

Enforced by `scripts/validate-mappack.mjs`:

1. File parses as a single JSON object.
2. `packId`: non-empty string matching `^[a-z0-9]+(-[a-z0-9]+)*$`.
3. `displayName`: non-empty trimmed string.
4. `projection.kind` is a known `ProjectionKind`; `width` and `height` are finite numbers > 0.
5. `source.name` and `source.license` are non-empty strings; packs must cite a
   public-domain or equivalently redistributable source.
6. `features` is a non-empty array.
7. Per feature: `id` is a non-empty string unique within the pack; `name` is non-empty;
   `aliases` when present is an array of non-empty, unique strings; `centroidHint` when
   present has finite numeric `x` and `y`.
8. No collisions: all `name`s are distinct case-insensitively, and no alias may equal any
   other feature's `name` or `alias` case-insensitively (an answer must resolve to at most
   one region).

## Versioning rules

- `packId` is immutable once a pack ships; iterate content under the same id.
- Feature `id`s are stable across versions; adding regions is safe, removing or renumbering
  requires a new `packId`.
- Prefer appending aliases over editing canonical `name`s mid-season.

## Provenance & legal

- Current data: [us-atlas](https://github.com/topojson/us-atlas) `states-albers-10m.json`
  (v3), built from US Census Bureau cartographic boundary files — **public domain**.
  The fetched snapshot contains 51 features: 50 states + District of Columbia. Puerto Rico
  is absent because `geoAlbersUsa` does not project it; add a separate pack if PR gameplay
  is wanted.
- Europe: [world-atlas](https://github.com/topojson/world-atlas) `countries-50m.json` (v2),
  built from Natural Earth 1:50m data — **public domain**. 39 countries with ISO alpha-2
  ids, pre-projected with `geoConicConformal` (parallels 35/65, rotated to 10°E) fitted to
  26°W–52°E / 33°N–72°N. Microstates (Andorra, Liechtenstein, Monaco, San Marino, Vatican)
  and Kosovo (unstable `-99` id in the source) are excluded; adding them later is safe under
  the same `packId`. Outlying territory (far-east Russia, Canaries, French Guiana) extends
  past the canvas and clips at the render edge.
- Only public-domain map data may be committed here. All artwork in `assets/brand/` is
  original to GeoRumble.
