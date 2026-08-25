// Shared SVG element factory for map-layer modules. createElementNS's
// overloads only resolve for literal tag names, so callers pin the type.
const SVG_NS = "http://www.w3.org/2000/svg";

export function createElement<T extends SVGElement = SVGElement>(tag: string): T {
  return document.createElementNS(SVG_NS, tag) as T;
}

/** Clip ids ride into SVG url(#...) references; strip anything unsafe. */
export function sanitizeClipId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "") || "anon";
}
