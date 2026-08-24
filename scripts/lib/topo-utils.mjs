// TopoJSON math shared by every pack builder: arc decoding, ring traversal,
// polygon centroids, and bounds. Pure functions over decoded coordinates —
// no I/O, no dependencies.

/** Returns arcIndex -> absolute points, decoding a quantized TopoJSON topology. */
export function decodeArcs(topology) {
  const [sx, sy] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  const cache = new Map();
  return (index) => {
    if (!cache.has(index)) {
      let x = 0;
      let y = 0;
      cache.set(
        index,
        topology.arcs[index].map(([dx, dy]) => {
          x += dx;
          y += dy;
          return [x * sx + tx, y * sy + ty];
        }),
      );
    }
    return cache.get(index);
  };
}

export function ringPoints(arcIndexes, arcAt) {
  const points = [];
  for (const index of arcIndexes) {
    const segment = index < 0 ? [...arcAt(~index)].reverse() : arcAt(index);
    points.push(...(points.length ? segment.slice(1) : segment));
  }
  return points;
}

export function areaAndCentroid(points) {
  let twiceArea = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    sumX += (x1 + x2) * cross;
    sumY += (y1 + y2) * cross;
  }
  if (twiceArea === 0) return null;
  return { absArea: Math.abs(twiceArea) / 2, x: sumX / (3 * twiceArea), y: sumY / (3 * twiceArea) };
}

/** Centroid of a geometry's largest outer ring, or null when it has none. */
export function mainRingCentroid(geometry, arcAt) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.arcs]
    : geometry.type === "MultiPolygon" ? geometry.arcs
    : [];
  let best = null;
  for (const polygon of polygons) {
    const candidate = areaAndCentroid(ringPoints(polygon[0], arcAt));
    if (candidate && (!best || candidate.absArea > best.absArea)) best = candidate;
  }
  return best;
}

/** Extent of the pixel space spanned by the given geometries. */
export function bounds(geometries, arcAt) {
  const xs = [];
  const ys = [];
  for (const geometry of geometries) {
    const rings =
      geometry.type === "Polygon" ? [geometry.arcs.flat()]
      : geometry.type === "MultiPolygon" ? geometry.arcs.flat()
      : [];
    for (const ring of rings) {
      for (const [x, y] of ringPoints(ring, arcAt)) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    width: Math.ceil(Math.max(...xs) - Math.min(...xs)),
    height: Math.ceil(Math.max(...ys) - Math.min(...ys)),
  };
}

/**
 * Builds an arc table from absolute (e.g. pre-projected) rings: each call to
 * toArcIndexes appends one delta-encoded arc and returns its index list, with
 * transform {scale:[1,1], translate:[0,0]} implied by the rounding.
 */
export function encodeArcsFromRings() {
  const arcs = [];
  const toArcIndexes = (points) => {
    const delta = [];
    let px = 0;
    let py = 0;
    for (const [x, y] of points) {
      const rx = Math.round(x);
      const ry = Math.round(y);
      delta.push([rx - px, ry - py]);
      px = rx;
      py = ry;
    }
    const index = arcs.length;
    arcs.push(delta);
    return [index];
  };
  return { arcs, toArcIndexes };
}
