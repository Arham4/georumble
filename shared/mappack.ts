export type ProjectionKind = "albers-usa-preprojected" | "equirectangular-geo";

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
