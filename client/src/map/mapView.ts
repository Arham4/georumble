import { geoIdentity, geoPath } from "d3-geo";
import type { FeatureCollection, GeometryObject } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { MapPack } from "../../../shared/mappack";
import { createElement, sanitizeClipId } from "./svgElement";
import { PeerCursorLayer } from "./peerCursors";

// Effective minimum click extent in viewBox units; smaller regions get an
// invisible fat-stroke halo so micro-regions stay clickable without zooming,
// and count as "tiny" for auto-framing helpers.
const HIT_MIN_UNITS = 26;
const MAX_ZOOM = 12;
const WHEEL_SENSITIVITY = 0.0016;
const LINE_DELTA_PX = 33;
const DRAG_SLOP_PX = 4;
const MISS_FLASH_MS = 700;
const POP_MS = 420;
const PRESS_MS = 260;
const ZOOM_TWEEN_MS = 480;
const CURSOR_SEND_MS = 80;
const CURSOR_SEND_MIN_UNITS = 1.5;
const HELPER_CIRCLE_PX = 18;
// Upper bound on a click halo's on-screen diameter at extreme zoom, so the
// world-footprint assists can never paint the whole viewport clickable.
const HALO_MAX_SCREEN_PX = 90;

type RegionParts = {
  path: SVGPathElement;
  hit: SVGPathElement | null;
  /** Dot packs counter-scale this wrapper on zoom; null for country packs. */
  wrap: SVGGElement | null;
};

type RegionGeo = {
  bounds: [[number, number], [number, number]];
  minDim: number;
};

export class MapView {
  readonly svg: SVGSVGElement;

  private readonly viewport: SVGGElement;
  private cursorLayer: SVGGElement | null = null;
  private hintRing: SVGCircleElement | null = null;
  private readonly regions = new Map<string, RegionParts>();
  private readonly geoById = new Map<string, RegionGeo>();
  /** Bounds-center pivot per region, cached so zoom frames skip the math. */
  private readonly dotPivots = new Map<string, [number, number]>();
  /** Zoom level the dot counter-scale was last applied at. */
  private lastDotK = 1;
  private readonly effectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly namesById = new Map<string, string>();
  private readonly centroidById = new Map<string, [number, number]>();
  private readonly halos: SVGPathElement[] = [];
  private readonly helpers = new Map<string, { group: SVGGElement; circle: SVGCircleElement }>();
  private readonly badgeGroups = new Map<string, SVGGElement>();
  private readonly peerLayer = new PeerCursorLayer(() => this.k);
  private dotPack = false;
  private badgeLayer: SVGGElement | null = null;
  private debugDot: SVGCircleElement | null = null;
  private lastCursorSentAt = 0;
  private lastCursorSentPoint: [number, number] = [NaN, NaN];
  private foundIds = new Set<string>();
  private hoveredId: string | null = null;
  private targetId: string | null = null;
  private hintOn = false;
  private interactive = false;
  private userZoomed = false;
  private width = 0;
  private height = 0;
  private viewMarginX = 0;
  private viewMarginY = 0;
  private k = 1;
  private tx = 0;
  private ty = 0;
  private tweenRaf: number | null = null;
  private drag: { pointerId: number; lastX: number; lastY: number; moved: boolean } | null = null;
  /** Live pointers for multi-touch; two of these turn drag into pinch-zoom. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; midX: number; midY: number } | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private debug = false;
  private guessHandler: (featureId: string) => void = () => {};
  private cursorHandler: (x: number, y: number) => void = () => {};

  constructor(host: HTMLElement) {
    this.svg = createElement<SVGSVGElement>("svg");
    this.svg.classList.add("map-svg");
    this.viewport = createElement<SVGGElement>("g");
    this.svg.append(this.viewport);

    this.svg.addEventListener("pointerdown", this.onPointerDown);
    this.svg.addEventListener("pointermove", this.onPointerMove);
    this.svg.addEventListener("pointerup", this.onPointerUp);
    this.svg.addEventListener("pointercancel", this.onPointerCancel);
    this.svg.addEventListener("pointerout", this.onPointerOut);
    this.svg.addEventListener("wheel", this.onWheel, { passive: false });

    host.append(this.svg);
    this.debug = new URLSearchParams(window.location.search).has("debug");
  }

  onGuess(handler: (featureId: string) => void): void {
    this.guessHandler = handler;
  }

  /** Throttled pointer positions in pack coordinates, emitted while playing. */
  onLocalCursor(handler: (x: number, y: number) => void): void {
    this.cursorHandler = handler;
  }

  updatePeerCursor(playerId: string, name: string, avatarUrl: string | null, x: number, y: number): void {
    this.peerLayer.upsert(playerId, name, avatarUrl, x, y);
  }

  dropPeerCursor(playerId: string): void {
    this.peerLayer.drop(playerId);
  }

  loadPack(pack: MapPack, topo: unknown): void {
    this.destroyRegions();
    this.foundIds = new Set();
    this.targetId = null;
    this.hintOn = false;
    this.userZoomed = false;
    this.resetView();

    this.width = pack.projection.width;
    this.height = pack.projection.height;
    this.namesById.clear();
    this.centroidById.clear();
    for (const item of pack.features) {
      this.namesById.set(item.id, item.name);
      if (item.centroidHint) {
        this.centroidById.set(item.id, [item.centroidHint.x, item.centroidHint.y]);
      }
    }
    // A uniform margin around the canvas zooms the fit out slightly, so the
    // map never touches the viewport edges — content would otherwise span the
    // full limiting dimension edge-to-edge with zero breathing room.
    const margin = 0.06;
    const mx = this.width * margin;
    const my = this.height * margin;
    this.viewMarginX = mx;
    this.viewMarginY = my;
    this.svg.setAttribute("viewBox", `${-mx} ${-my} ${this.width + 2 * mx} ${this.height + 2 * my}`);
    this.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // Pre-projected coordinates: the file already lives in the pack's canvas
    // (0,0..width,height), so render with a plain identity transform. Refitting
    // against the collection would rescale by its outlying geometry (Russia's
    // far east, the Canaries) and shrink the actual continent.
    const collection = extractLargestCollection(topo);
    const path = geoPath(geoIdentity());

    const hitLayer = createElement("g");
    const regionLayer = createElement("g");
    this.dotPack = pack.dotPack === true;
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
      // Dot packs zoom via a per-dot counter-scale on a wrapper, so CSS flash
      // animations on the path itself never fight the zoom transform.
      let wrap: SVGGElement | null = null;
      if (this.dotPack) {
        wrap = createElement<SVGGElement>("g");
        wrap.append(region);
        regionLayer.append(wrap);
      } else {
        regionLayer.append(region);
      }

      let hit: SVGPathElement | null = null;
      const bounds = path.bounds(geometry);
      const minDim = Math.min(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1]);
      if (minDim < HIT_MIN_UNITS) {
        hit = createElement<SVGPathElement>("path");
        hit.setAttribute("d", d);
        hit.setAttribute("data-region-id", id);
        hit.classList.add("hit-area");
        hit.dataset.baseStroke = String((HIT_MIN_UNITS - minDim) * 2 + 8);
        hit.setAttribute("stroke-width", String((HIT_MIN_UNITS - minDim) * 2 + 8));
        this.halos.push(hit);
        hitLayer.append(hit);
      }
      this.regions.set(id, { path: region, hit, wrap });
      this.geoById.set(id, { bounds, minDim });
    }
    const cursors = createElement<SVGGElement>("g");
    cursors.classList.add("cursor-layer");
    this.cursorLayer = cursors;
    this.peerLayer.setLayer(cursors);
    const helperLayer = this.buildHelperLayer(pack);
    const badges = createElement<SVGGElement>("g");
    badges.classList.add("badge-layer");
    this.badgeLayer = badges;
    // Dot packs ship a land underlay as a background object; it renders as
    // pure decoration beneath every interactive layer.
    const bgLayer = createElement<SVGGElement>("g");
    bgLayer.classList.add("map-bg-layer");
    const bgObject = (topo as Topology).objects.background;
    if (bgObject && bgObject.type === "GeometryCollection" && bgObject.geometries?.length) {
      const bgCollection = feature(topo as Topology, bgObject) as FeatureCollection<GeometryObject>;
      for (const bgFeature of bgCollection.features) {
        const d = path(bgFeature);
        if (!d) {
          continue;
        }
        const bgPath = createElement<SVGPathElement>("path");
        bgPath.setAttribute("d", d);
        bgPath.classList.add("map-bg");
        bgLayer.append(bgPath);
      }
    }
    this.viewport.replaceChildren(bgLayer, hitLayer, regionLayer, helperLayer, badges, cursors);
    if (this.debug) {
      const dot = createElement<SVGCircleElement>("circle");
      dot.classList.add("debug-dot");
      dot.setAttribute("r", "4");
      dot.setAttribute("opacity", "0");
      this.viewport.append(dot);
      this.debugDot = dot;
    }
  }

  destroy(): void {
    for (const timer of this.effectTimers.values()) {
      clearTimeout(timer);
    }
    this.effectTimers.clear();
    if (this.tweenRaf !== null) {
      cancelAnimationFrame(this.tweenRaf);
    }
    this.svg.remove();
  }

  setFound(
    ids: readonly string[],
    missesByRegion: Record<string, number> = {},
    foundBy: Record<string, string> = {},
    players: ReadonlyMap<string, { name: string; avatar: string | null }> = new Map(),
  ): void {
    const next = new Set(ids);
    for (const [id, parts] of this.regions) {
      const isFound = next.has(id);
      if (isFound !== this.foundIds.has(id)) {
        parts.path.classList.toggle("found", isFound);
      }
      const tier = heatTier(missesByRegion[id] ?? 0);
      for (const cls of ["heat-clean", "heat-warm", "heat-hard"]) {
        parts.path.classList.toggle(cls, isFound && cls === tier);
      }
    }
    for (const [id, helper] of this.helpers) {
      helper.group.classList.toggle("found", next.has(id));
    }
    this.foundIds = next;
    this.renderBadges(foundBy, players);
    this.syncHint();
  }

  /**
   * Finder badges: the player's avatar drawn once per found region, at a
   * FIXED size centered on the region's centroid and clipped to the region's
   * own outline — never resized, so a big region shows the whole icon while a
   * small one shows whatever sliver fits around the center.
   */
  private renderBadges(
    foundBy: Record<string, string>,
    players: ReadonlyMap<string, { name: string; avatar: string | null }>,
  ): void {
    const layer = this.badgeLayer;
    if (!layer) {
      return;
    }
    layer.replaceChildren();
    this.badgeGroups.clear();
    for (const id of this.foundIds) {
      const player = foundBy[id] ? players.get(foundBy[id]) : undefined;
      const d = this.regions.get(id)?.path.getAttribute("d");
      const center = this.centroidById.get(id);
      if (!player || !d || !center) {
        continue;
      }
      // Dot packs shrink the chip to fit inside the dot — a fixed 30-unit
      // badge on a 7-unit dot is all crop, while fitting shows the whole
      // icon. Big regions keep the full-size chip.
      const geo = this.geoById.get(id);
      const size = this.dotPack && geo ? Math.min(30, geo.minDim * 0.8) : 30;
      const clipId = `badge-clip-${sanitizeClipId(id)}`;
      const defs = createElement<SVGElement>("defs");
      const clip = createElement<SVGClipPathElement>("clipPath");
      clip.setAttribute("id", clipId);
      const shape = createElement<SVGPathElement>("path");
      shape.setAttribute("d", d);
      clip.append(shape);
      defs.append(clip);
      // Avatars read as circular chips everywhere else in the UI, so the
      // square image is circle-clipped first, then region-clipped.
      const circleId = `badge-circle-${sanitizeClipId(id)}`;
      const circleClip = createElement<SVGClipPathElement>("clipPath");
      circleClip.setAttribute("id", circleId);
      const circle = createElement<SVGCircleElement>("circle");
      circle.setAttribute("cx", String(center[0]));
      circle.setAttribute("cy", String(center[1]));
      circle.setAttribute("r", String(size / 2));
      circleClip.append(circle);
      defs.append(circleClip);

      const clipped = createElement<SVGGElement>("g");
      clipped.setAttribute("clip-path", `url(#${clipId})`);
      if (player.avatar) {
        const image = createElement<SVGImageElement>("image");
        image.setAttribute("href", player.avatar);
        image.setAttribute("x", String(center[0] - size / 2));
        image.setAttribute("y", String(center[1] - size / 2));
        image.setAttribute("width", String(size));
        image.setAttribute("height", String(size));
        image.setAttribute("preserveAspectRatio", "xMidYMid slice");
        image.setAttribute("clip-path", `url(#${circleId})`);
        clipped.append(image);
      } else {
        const dot = createElement<SVGCircleElement>("circle");
        dot.classList.add("badge-dot");
        dot.setAttribute("cx", String(center[0]));
        dot.setAttribute("cy", String(center[1]));
        dot.setAttribute("r", String(size / 2));
        clipped.append(dot);
        const initial = createElement<SVGTextElement>("text");
        initial.classList.add("badge-initial");
        initial.setAttribute("x", String(center[0]));
        initial.setAttribute("y", String(center[1]));
        initial.setAttribute("text-anchor", "middle");
        initial.setAttribute("dominant-baseline", "central");
        initial.textContent = (player.name.trim()[0] ?? "?").toUpperCase();
        initial.style.fontSize = `${Math.max(6, Math.round(size * 0.5))}px`;
        clipped.append(initial);
      }
      const group = createElement<SVGGElement>("g");
      group.append(defs, clipped);
      this.badgeGroups.set(id, group);
      layer.append(group);
    }
    // Fresh groups carry no counter-scale — apply it now rather than waiting
    // for the next camera move, or badges render k× oversized until then.
    this.applyDotScale(true);
  }

  setTarget(id: string | null): void {
    this.targetId = id;
    this.syncHint();
    this.placeHintRing();
  }

  setHint(on: boolean): void {
    this.hintOn = on;
    this.syncHint();
    this.placeHintRing();
    // Earned help only: after repeated misses the camera may drift toward a
    // tiny target, but gently — never a round-start slam that gives it away.
    if (on && this.targetId !== null && this.isTiny(this.targetId) && !this.userZoomed) {
      this.zoomToRegion(this.targetId, 3, 5);
    }
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    this.svg.classList.toggle("interactive", on);
    if (!on) {
      this.setHovered(null);
    }
  }

  zoomStep(factor: number): void {
    this.userZoomed = true;
    this.zoomAt(factor, this.width / 2, this.height / 2);
  }

  /**
   * Keyboard camera control: arrows pan, +/- zoom, Home resets. Ignored
   * outside active play and while typing in a field.
   */
  handleShortcut(event: KeyboardEvent): void {
    if (!this.interactive) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }
    const pan = 60 / this.viewScale();
    switch (event.key) {
      case "ArrowLeft":
        this.nudge(-pan, 0);
        break;
      case "ArrowRight":
        this.nudge(pan, 0);
        break;
      case "ArrowUp":
        this.nudge(0, -pan);
        break;
      case "ArrowDown":
        this.nudge(0, pan);
        break;
      case "+":
      case "=":
        this.userZoomed = true;
        this.zoomStep(1.4);
        break;
      case "-":
      case "_":
        this.userZoomed = true;
        this.zoomStep(1 / 1.4);
        break;
      case "Home":
        this.resetView();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private nudge(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.clampPan();
    this.applyTransform();
    this.refreshHover("camera");
  }

  resetView(): void {
    this.userZoomed = false;
    this.tweenView({ k: 1, tx: 0, ty: 0 }, 0);
  }

  flashCorrect(id: string): void {
    this.flash(id, "pop", POP_MS);
  }

  flashMiss(id: string): void {
    this.flash(id, "miss", MISS_FLASH_MS);
  }

  /** Instant neutral ack that a click was received, before any verdict. */
  pressFeedback(id: string): void {
    this.flash(id, "pressed", PRESS_MS);
  }

  private isTiny(id: string): boolean {
    return (this.geoById.get(id)?.minDim ?? Infinity) < HIT_MIN_UNITS;
  }

  /**
   * Seterra-style helpers: for regions too small to click fairly, a translucent
   * circle floats in open space beside them — the pack bakes each anchor
   * (typically offshore) — with a leader line to the real region, so specks
   * like DC or Malta are clickable at any zoom without covering the map. The
   * group carries data-region-id, so the regular hover/click pipeline just
   * works; the line is display-only.
   */
  private buildHelperLayer(pack: MapPack): SVGGElement {
    this.helpers.clear();
    const layer = createElement<SVGGElement>("g");
    layer.classList.add("helper-layer");
    for (const helper of pack.helpers ?? []) {
      const centroid = this.centroidById.get(helper.id);
      if (!centroid) {
        continue;
      }
      const group = createElement<SVGGElement>("g");
      group.classList.add("helper");
      group.setAttribute("data-region-id", helper.id);

      const line = createElement<SVGLineElement>("line");
      line.classList.add("helper-line");
      line.setAttribute("x1", String(helper.anchor.x));
      line.setAttribute("y1", String(helper.anchor.y));
      line.setAttribute("x2", String(centroid[0]));
      line.setAttribute("y2", String(centroid[1]));
      line.setAttribute("vector-effect", "non-scaling-stroke");
      group.append(line);

      const circle = createElement<SVGCircleElement>("circle");
      circle.classList.add("helper-circle");
      circle.setAttribute("cx", String(helper.anchor.x));
      circle.setAttribute("cy", String(helper.anchor.y));
      group.append(circle);

      layer.append(group);
      this.helpers.set(helper.id, { group, circle });
    }
    this.rescaleHelperCircles();
    return layer;
  }

  private rescaleHelperCircles(): void {
    const r = this.constantWorldSize(HELPER_CIRCLE_PX);
    for (const { circle } of this.helpers.values()) {
      circle.setAttribute("r", String(r));
    }
  }

  /**
   * Screen pixels per world unit under the current camera. Every
   * "constant on-screen size" assist divides its pixel budget by this — one
   * formula so halos and helper circles stay mutually consistent even when
   * the svg letterboxes (viewScale < 1 shrinks every world unit).
   */
  private constantWorldSize(screenPx: number): number {
    return screenPx / Math.max(1, this.viewScale() * this.k);
  }

  private placeHintRing(): void {
    this.hintRing?.remove();
    this.hintRing = null;
    // Normal-sized regions already pulse via their dashed outline; the ring
    // exists for tiny regions whose outline is invisible without zooming.
    if (!this.hintOn || this.targetId === null || !this.isTiny(this.targetId)) {
      return;
    }
    const id = this.targetId;
    const geo = this.geoById.get(id);
    if (!geo) {
      return;
    }
    const [min, max] = geo.bounds;
    const hint = this.centroidById.get(id);
    const cx = hint ? hint[0] : (min[0] + max[0]) / 2;
    const cy = hint ? hint[1] : (min[1] + max[1]) / 2;
    const minDim = Math.min(max[0] - min[0], max[1] - min[1]);
    const ring = createElement<SVGCircleElement>("circle");
    ring.classList.add("hint-ring");
    ring.setAttribute("cx", String(cx));
    ring.setAttribute("cy", String(cy));
    ring.setAttribute("r", String(Math.min(30, Math.max(8, minDim * 0.45))));
    this.viewport.append(ring);
    this.hintRing = ring;
  }

  private zoomToRegion(id: string, inflate: number, maxK: number = MAX_ZOOM): void {
    const geo = this.geoById.get(id);
    if (!geo) {
      return;
    }
    const [min, max] = geo.bounds;
    const span = Math.max(max[0] - min[0], max[1] - min[1]) * inflate;
    const k = Math.min(maxK, Math.max(1, (Math.min(this.width, this.height) * 0.85) / span));
    // Center on the visual mass (overseas territories skew raw bbox centers —
    // France's includes French Guiana), clamped into the canvas.
    const hint = this.centroidById.get(id);
    const cx = Math.min(this.width, Math.max(0, hint ? hint[0] : (min[0] + max[0]) / 2));
    const cy = Math.min(this.height, Math.max(0, hint ? hint[1] : (min[1] + max[1]) / 2));
    this.tweenView(
      {
        k,
        tx: this.width / 2 - cx * k,
        ty: this.height / 2 - cy * k,
      },
      ZOOM_TWEEN_MS,
    );
  }

  private tweenView(target: { k: number; tx: number; ty: number }, durationMs: number): void {
    if (this.tweenRaf !== null) {
      cancelAnimationFrame(this.tweenRaf);
      this.tweenRaf = null;
    }
    const from = { k: this.k, tx: this.tx, ty: this.ty };
    if (durationMs <= 0) {
      this.k = target.k;
      this.tx = target.tx;
      this.ty = target.ty;
      this.clampPan();
      this.applyTransform();
      return;
    }
    const startedAt = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = easeInOut(progress);
      this.k = from.k + (target.k - from.k) * eased;
      this.tx = from.tx + (target.tx - from.tx) * eased;
      this.ty = from.ty + (target.ty - from.ty) * eased;
      this.clampPan();
      this.applyTransform();
      if (progress < 1) {
        this.tweenRaf = requestAnimationFrame(step);
      } else {
        this.tweenRaf = null;
      }
    };
    this.tweenRaf = requestAnimationFrame(step);
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
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.svg.setPointerCapture(event.pointerId);
    this.svg.classList.add("dragging");
    if (this.pointers.size === 2) {
      // Second finger down: pan-drag becomes a pinch, re-anchored on the pair.
      this.drag = null;
      this.beginPinch();
    } else if (this.pointers.size === 1) {
      this.drag = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, moved: false };
    }
  };

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  private onPointerMove = (event: PointerEvent): void => {
    const tracked = this.pointers.get(event.pointerId);
    if (tracked) {
      tracked.x = event.clientX;
      tracked.y = event.clientY;
    }
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      // Zoom anchored under the pinch midpoint; midpoint travel pans, so
      // two fingers behave like every other map app.
      const [ax, ay] = this.clientToView(this.pinch.midX, this.pinch.midY);
      this.userZoomed = true;
      this.zoomAt(dist / this.pinch.dist, ax, ay);
      const scale = this.viewScale();
      this.tx += (midX - this.pinch.midX) / scale;
      this.ty += (midY - this.pinch.midY) / scale;
      this.clampPan();
      this.applyTransform();
      this.pinch = { dist, midX, midY };
      return;
    }
    const drag = this.drag;
    if (drag && event.pointerId === drag.pointerId) {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      if (!drag.moved && Math.hypot(dx, dy) > DRAG_SLOP_PX) {
        drag.moved = true;
      }
      if (drag.moved) {
        const scale = this.viewScale();
        this.tx += dx / scale;
        this.ty += dy / scale;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        this.clampPan();
        this.applyTransform();
      }
      return;
    }
    if (this.interactive) {
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (this.debugDot) {
        const [wx, wy] = this.viewToWorld(...this.clientToView(event.clientX, event.clientY));
        this.debugDot.setAttribute("cx", String(wx));
        this.debugDot.setAttribute("cy", String(wy));
        this.debugDot.setAttribute("opacity", "0.9");
      }
      this.refreshHover("pointer");
      this.maybeSendCursor(event.clientX, event.clientY);
    }
  };

  /**
   * Hover must track the true pointer position, recomputed on both pointer
   * moves AND camera changes — zooming or tweening slides regions under a
   * still cursor without firing any pointer events.
   */
  private refreshHover(source: "pointer" | "camera"): void {
    if (!this.interactive || this.drag || this.lastPointer === null) {
      return;
    }
    const id = regionIdAtPoint(this.lastPointer.x, this.lastPointer.y);
    if (this.debug) {
      const el = document.elementFromPoint(this.lastPointer.x, this.lastPointer.y);
      const kind = el?.classList.contains("hit-area") ? "[halo]" : "";
      console.log(
        `[hover] src=${source} point=(${this.lastPointer.x},${this.lastPointer.y}) ` +
          `element=${el?.tagName ?? "null"}${kind}#${el?.getAttribute?.("data-region-id") ?? "-"} ` +
          `-> ${id ?? "null"} k=${this.k.toFixed(2)}`,
      );
    }
    this.setHovered(id);
  }

  private maybeSendCursor(clientX: number, clientY: number): void {
    const now = performance.now();
    if (now - this.lastCursorSentAt < CURSOR_SEND_MS) {
      return;
    }
    const [x, y] = this.viewToWorld(...this.clientToView(clientX, clientY));
    const [lastX, lastY] = this.lastCursorSentPoint;
    if (
      Number.isFinite(lastX) &&
      Math.hypot(x - lastX, y - lastY) < CURSOR_SEND_MIN_UNITS
    ) {
      return;
    }
    this.lastCursorSentAt = now;
    this.lastCursorSentPoint = [x, y];
    this.cursorHandler(x, y);
  }

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) {
        this.pinch = null;
        // A finger lifted from a pinch: the remaining one drags from here
        // instead of teleporting the map on its next move. `moved` stays
        // true so the lift never reads as a click.
        const remaining = this.pointers.entries().next();
        if (!remaining.done) {
          const [pointerId, rest] = remaining.value;
          this.drag = { pointerId, lastX: rest.x, lastY: rest.y, moved: true };
        }
      }
      if (this.pointers.size === 0) {
        this.releaseDrag(event.pointerId);
      }
      return;
    }
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
    this.pointers.delete(event.pointerId);
    // Same recovery as a pinch finger lifting: keep the surviving pointer
    // panning instead of stranding the map mid-gesture (palm rejection and
    // OS interruptions cancel rather than lift).
    if (this.pinch) {
      if (this.pointers.size === 1) {
        this.pinch = null;
        const remaining = this.pointers.entries().next();
        if (!remaining.done) {
          const [pointerId, rest] = remaining.value;
          this.drag = { pointerId, lastX: rest.x, lastY: rest.y, moved: true };
        }
      } else if (this.pointers.size === 0) {
        this.pinch = null;
      }
      return;
    }
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

  private onPointerOut = (): void => {
    if (!this.drag) {
      this.setHovered(null);
    }
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? LINE_DELTA_PX : 1);
    const [cx, cy] = this.clientToView(event.clientX, event.clientY);
    this.userZoomed = true;
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
    // Draggable at every zoom — including fit zoom, so the map can be slid
    // around freely — clamped only to keep a quarter of the canvas findable;
    // the home button recovers the standard fit.
    const minVisible = 0.25;
    this.tx = Math.min(
      this.width * (1 - minVisible),
      Math.max(this.width * (minVisible - this.k), this.tx),
    );
    this.ty = Math.min(
      this.height * (1 - minVisible),
      Math.max(this.height * (minVisible - this.k), this.ty),
    );
  }

  private applyTransform(): void {
    this.viewport.setAttribute("transform", `translate(${this.tx} ${this.ty}) scale(${this.k})`);
    // Click halos keep their WORLD footprint: constant-screen assists shrink
    // relative to the neighbors zooming spreads apart, which is exactly when
    // specks need a generous target. A screen cap stops extreme zooms from
    // painting the whole viewport clickable.
    const capWorld = this.constantWorldSize(HALO_MAX_SCREEN_PX);
    for (const halo of this.halos) {
      const base = Number(halo.dataset.baseStroke ?? 0);
      if (base > 0) {
        halo.setAttribute("stroke-width", String(Math.min(base, capWorld).toFixed(2)));
      }
    }
    this.rescaleHelperCircles();
    this.debugDot?.setAttribute("r", String(4 / this.k));
    this.applyDotScale();
    this.refreshHover("camera");
  }

  /**
   * Dot packs hold dots at a constant ON-SCREEN size: while the viewport
   * zooms, every dot counter-scales around its own center, so zooming
   * spreads dense neighbors apart instead of letting dots balloon over
   * them. Zoom can never shrink overlap on its own — spacing and radius
   * scale equally — so this counter-scale is what makes zoom useful on
   * dense packs. Badges ride the same transform and stay glued to their
   * dots.
   */
  private applyDotScale(force = false): void {
    if (!this.dotPack || (!force && this.k === this.lastDotK)) {
      return;
    }
    this.lastDotK = this.k;
    for (const [id, parts] of this.regions) {
      let pivot = this.dotPivots.get(id);
      if (!pivot) {
        const geo = this.geoById.get(id);
        if (!geo) {
          continue;
        }
        pivot = [(geo.bounds[0][0] + geo.bounds[1][0]) / 2, (geo.bounds[0][1] + geo.bounds[1][1]) / 2];
        this.dotPivots.set(id, pivot);
      }
      const [cx, cy] = pivot;
      const transform =
        this.k === 1
          ? null
          : `translate(${cx} ${cy}) scale(${(1 / this.k).toFixed(4)}) translate(${-cx} ${-cy})`;
      const nodes: (SVGGElement | SVGPathElement | null | undefined)[] = [
        parts.wrap,
        parts.hit,
        this.badgeGroups.get(id),
      ];
      for (const node of nodes) {
        if (!node) {
          continue;
        }
        if (transform === null) {
          node.removeAttribute("transform");
        } else {
          node.setAttribute("transform", transform);
        }
      }
    }
  }

  private viewScale(): number {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return 1;
    }
    return Math.min(rect.width / this.viewWidth(), rect.height / this.viewHeight());
  }

  private viewWidth(): number {
    return this.width + 2 * this.viewMarginX;
  }

  private viewHeight(): number {
    return this.height + 2 * this.viewMarginY;
  }

  /** Maps a client point through the preserveAspectRatio letterboxing. */
  private clientToView(clientX: number, clientY: number): [number, number] {
    const rect = this.svg.getBoundingClientRect();
    const scale = this.viewScale();
    const offsetX = (rect.width - this.viewWidth() * scale) / 2;
    const offsetY = (rect.height - this.viewHeight() * scale) / 2;
    return [
      (clientX - rect.left - offsetX) / scale - this.viewMarginX,
      (clientY - rect.top - offsetY) / scale - this.viewMarginY,
    ];
  }

  /** Cursor chips live inside the transformed viewport, so shared positions
   * must be world coordinates — the sender's own pan/zoom inverted out. */
  private viewToWorld(vx: number, vy: number): [number, number] {
    return [(vx - this.tx) / this.k, (vy - this.ty) / this.k];
  }

  private destroyRegions(): void {
    for (const timer of this.effectTimers.values()) {
      clearTimeout(timer);
    }
    this.effectTimers.clear();
    this.regions.clear();
    this.geoById.clear();
    this.dotPivots.clear();
    this.lastDotK = 1;
    this.centroidById.clear();
    this.halos.length = 0;
    this.helpers.clear();
    this.badgeGroups.clear();
    this.dotPack = false;
    this.badgeLayer = null;
    this.debugDot = null;
    this.peerLayer.dispose();
    this.hintRing = null;
    this.cursorLayer = null;
    this.viewport.replaceChildren();
  }
}

function heatTier(misses: number): string {
  if (misses >= 3) {
    return "heat-hard";
  }
  if (misses >= 1) {
    return "heat-warm";
  }
  return "heat-clean";
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
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
// pin the element type instead — the shared factory lives in svgElement.ts.
