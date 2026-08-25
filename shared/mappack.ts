export type ProjectionKind =
  | "albers-usa-preprojected"
  | "conic-conformal-preprojected"
  | "equirectangular-geo"
  | "mercator-preprojected";

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

export type PackHelper = {
  /** The feature this helper clicks as; must match a MapFeature.id. */
  id: string;
  /**
   * Where the circle floats, in the pack's projected coordinate space — open
   * space beside the region (typically offshore) so it never covers other
   * regions. The renderer draws a leader line from here to the region's
   * centroidHint.
   */
  anchor: CentroidHint;
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
  /** Seterra-style helper circles for regions too small to click fairly. Optional. */
  helpers?: PackHelper[];
  /**
   * Dot packs (POI targets): the client holds dots at a constant on-screen
   * size while zooming, so dense packs separate instead of blobbing.
   */
  dotPack?: boolean;
};
