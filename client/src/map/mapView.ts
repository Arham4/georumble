import { geoIdentity, geoPath } from "d3-geo";
import type { FeatureCollection, GeometryObject } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { MapPack } from "../../../shared/mappack";

const SVG_NS = "http://www.w3.org/2000/svg";
const FIT_PAD = 8;
// Effective minimum click extent in viewBox units; smaller regions get an
// invisible fat-stroke halo so micro-regions stay clickable without zooming.
const HIT_MIN_UNITS = 26;
const MAX_ZOOM = 12;
const WHEEL_SENSITIVITY = 0.0016;
const LINE_DELTA_PX = 33;
const DRAG_SLOP_PX = 4;
const MISS_FLASH_MS = 700;
const POP_MS = 420;

type RegionParts = {
  path: SVGPathElement;
  hit: SVGPathElement | null;
};

export class MapView {
  readonly svg: SVGSVGElement;

  private readonly viewport: SVGGElement;
  private readonly regions = new Map<string, RegionParts>();
  private readonly effectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly namesById = new Map<string, string>();
  private foundIds = new Set<string>();
  private hoveredId: string | null = null;
  private targetId: string | null = null;
  private hintOn = false;
  private interactive = false;
  private width = 0;
  private height = 0;
  private k = 1;
  private tx = 0;
  private ty = 0;
  private drag: { pointerId: number; lastX: number; lastY: number; moved: boolean } | null = null;
  private guessHandler: (featureId: string) => void = () => {};

  constructor(host: HTMLElement) {
    this.svg = createElement<SVGSVGElement>("svg");
    this.svg.classList.add("map-svg");
    this.viewport = createElement<SVGGElement>("g");
    this.svg.append(this.viewport);

    this.svg.addEventListener("pointerdown", this.onPointerDown);
    this.svg.addEventListener("pointermove", this.onPointerMove);
    this.svg.addEventListener("pointerup", this.onPointerUp);
    this.svg.addEventListener("pointercancel", this.onPointerCancel);
    this.svg.addEventListener("pointerover", this.onPointerOver);
    this.svg.addEventListener("pointerout", this.onPointerOut);
    this.svg.addEventListener("wheel", this.onWheel, { passive: false });

    host.append(this.svg);
  }

  onGuess(handler: (featureId: string) => void): void {
    this.guessHandler = handler;
  }

  loadPack(pack: MapPack, topo: unknown): void {
    this.destroyRegions();
    this.foundIds = new Set();
    this.targetId = null;
    this.hintOn = false;
    this.resetView();

    this.width = pack.projection.width;
    this.height = pack.projection.height;
    this.namesById.clear();
    for (const item of pack.features) {
      this.namesById.set(item.id, item.name);
    }
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // Pre-projected coordinates: fit them into the pack's canvas as-is, no reprojection.
    const collection = extractLargestCollection(topo);
    const projection = geoIdentity().fitExtent(
      [
        [FIT_PAD, FIT_PAD],
        [this.width - FIT_PAD, this.height - FIT_PAD],
      ],
      collection,
    );
    const path = geoPath(projection);

    const hitLayer = createElement("g");
    const regionLayer = createElement("g");
    for (const geometry of collection.features) {
      const id = String(geometry.id ?? "");
      if (!this.namesById.has(id)) {
        continue;
      }
      const d = path(geometry);
      if (!d) {
        continue;
      }
      const region = createElement<SVGPathElement>("path");
      region.setAttribute("d", d);
      region.setAttribute("data-region-id", id);
      region.classList.add("region");
      const label = createElement("title");
      label.textContent = this.namesById.get(id) ?? "";
      region.append(label);
      regionLayer.append(region);

      let hit: SVGPathElement | null = null;
      const bounds = path.bounds(geometry);
      const minDim = Math.min(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1]);
      if (minDim < HIT_MIN_UNITS) {
        hit = createElement<SVGPathElement>("path");
        hit.setAttribute("d", d);
        hit.setAttribute("data-region-id", id);
        hit.classList.add("hit-area");
        hit.setAttribute("stroke-width", String((HIT_MIN_UNITS - minDim) * 1.5 + 6));
        hitLayer.append(hit);
      }
      this.regions.set(id, { path: region, hit });
    }
    this.viewport.replaceChildren(hitLayer, regionLayer);
  }

  destroy(): void {
    for (const timer of this.effectTimers.values()) {
      clearTimeout(timer);
    }
    this.effectTimers.clear();
    this.svg.remove();
  }

  setFound(ids: readonly string[]): void {
    const next = new Set(ids);
    for (const [id, parts] of this.regions) {
      const isFound = next.has(id);
      if (isFound !== this.foundIds.has(id)) {
        parts.path.classList.toggle("found", isFound);
      }
    }
    this.foundIds = next;
    this.syncHint();
  }

  setTarget(id: string | null): void {
    this.targetId = id;
    this.syncHint();
  }

  setHint(on: boolean): void {
    this.hintOn = on;
    this.syncHint();
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    this.svg.classList.toggle("interactive", on);
    if (!on) {
      this.setHovered(null);
    }
  }

  zoomStep(factor: number): void {
    this.zoomAt(factor, this.width / 2, this.height / 2);
  }

  resetView(): void {
    this.k = 1;
    this.tx = 0;
    this.ty = 0;
    this.applyTransform();
  }

  flashCorrect(id: string): void {
    this.flash(id, "pop", POP_MS);
  }

  flashMiss(id: string): void {
    this.flash(id, "miss", MISS_FLASH_MS);
  }

  private flash(id: string, className: string, durationMs: number): void {
    const parts = this.regions.get(id);
    if (!parts) {
      return;
    }
    const key = `${className}:${id}`;
    const existing = this.effectTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.effectTimers.delete(key);
    }
    parts.path.classList.remove(className);
    parts.path.getBoundingClientRect();
    parts.path.classList.add(className);
    const timer = setTimeout(() => {
      parts.path.classList.remove(className);
      this.effectTimers.delete(key);
    }, durationMs);
    this.effectTimers.set(key, timer);
  }

  private syncHint(): void {
    for (const [id, parts] of this.regions) {
      parts.path.classList.toggle(
        "hint",
        this.hintOn && id === this.targetId && !this.foundIds.has(id),
      );
    }
  }

  private setHovered(id: string | null): void {
    const next = id !== null && !this.foundIds.has(id) ? id : null;
    if (next === this.hoveredId) {
      return;
    }
    if (this.hoveredId !== null) {
      this.regions.get(this.hoveredId)?.path.classList.remove("hover");
    }
    this.hoveredId = next;
    if (next !== null) {
      this.regions.get(next)?.path.classList.add("hover");
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    this.drag = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, moved: false };
    this.svg.setPointerCapture(event.pointerId);
    this.svg.classList.add("dragging");
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_SLOP_PX) {
      drag.moved = true;
    }
    if (!drag.moved) {
      return;
    }
    const scale = this.viewScale();
    this.tx += dx / scale;
    this.ty += dy / scale;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    this.clampPan();
    this.applyTransform();
  };

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    this.drag = null;
    this.releaseDrag(event.pointerId);
    if (drag.moved || !this.interactive) {
      return;
    }
    const id = regionIdAtPoint(event.clientX, event.clientY);
    if (id !== null) {
      this.guessHandler(id);
    }
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (this.drag?.pointerId !== event.pointerId) {
      return;
    }
    this.drag = null;
    this.releaseDrag(event.pointerId);
  };

  private releaseDrag(pointerId: number): void {
    this.svg.classList.remove("dragging");
    if (this.svg.hasPointerCapture(pointerId)) {
      this.svg.releasePointerCapture(pointerId);
    }
  }

  private onPointerOver = (event: PointerEvent): void => {
    if (!this.interactive || this.drag) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    this.setHovered(target?.closest("[data-region-id]")?.getAttribute("data-region-id") ?? null);
  };

  private onPointerOut = (): void => {
    if (!this.drag) {
      this.setHovered(null);
    }
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? LINE_DELTA_PX : 1);
    const [cx, cy] = this.clientToView(event.clientX, event.clientY);
    this.zoomAt(Math.exp(-delta * WHEEL_SENSITIVITY), cx, cy);
  };

  private zoomAt(factor: number, cx: number, cy: number): void {
    const nextK = Math.min(MAX_ZOOM, Math.max(1, this.k * factor));
    if (nextK === this.k) {
      this.clampPan();
      this.applyTransform();
      return;
    }
    const ratio = nextK / this.k;
    this.tx = cx - (cx - this.tx) * ratio;
    this.ty = cy - (cy - this.ty) * ratio;
    this.k = nextK;
    this.clampPan();
    this.applyTransform();
  }

  private clampPan(): void {
    this.tx = Math.min(0, Math.max(this.width * (1 - this.k), this.tx));
    this.ty = Math.min(0, Math.max(this.height * (1 - this.k), this.ty));
  }

  private applyTransform(): void {
    this.viewport.setAttribute("transform", `translate(${this.tx} ${this.ty}) scale(${this.k})`);
  }

  private viewScale(): number {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return 1;
    }
    return Math.min(rect.width / this.width, rect.height / this.height);
  }

  /** Maps a client point through the preserveAspectRatio letterboxing. */
  private clientToView(clientX: number, clientY: number): [number, number] {
    const rect = this.svg.getBoundingClientRect();
    const scale = this.viewScale();
    const offsetX = (rect.width - this.width * scale) / 2;
    const offsetY = (rect.height - this.height * scale) / 2;
    return [(clientX - rect.left - offsetX) / scale, (clientY - rect.top - offsetY) / scale];
  }

  private destroyRegions(): void {
    for (const timer of this.effectTimers.values()) {
      clearTimeout(timer);
    }
    this.effectTimers.clear();
    this.regions.clear();
    this.viewport.replaceChildren();
  }
}

function extractLargestCollection(topo: unknown): FeatureCollection<GeometryObject> {
  const topology = topo as Topology;
  let largest: GeometryCollection | null = null;
  for (const object of Object.values(topology.objects ?? {})) {
    if (object.type !== "GeometryCollection") {
      continue;
    }
    const collection = object as GeometryCollection;
    if (!largest || collection.geometries.length > largest.geometries.length) {
      largest = collection;
    }
  }
  if (!largest) {
    throw new Error("Topology has no GeometryCollection object");
  }
  return feature(topology, largest);
}

function regionIdAtPoint(clientX: number, clientY: number): string | null {
  const element = document.elementFromPoint(clientX, clientY);
  return element?.closest("[data-region-id]")?.getAttribute("data-region-id") ?? null;
}

// createElementNS's overloads only resolve for literal tag names, so callers
// pin the element type instead.
function createElement<T extends SVGElement = SVGElement>(tag: string): T {
  return document.createElementNS(SVG_NS, tag) as T;
}
