// Peer cursor layer: every remote player's pointer rendered as a chip that
// lerps toward its latest reported position, holds a constant on-screen size
// against the camera zoom, and cleans itself up when the peer goes quiet.
// Pure presentation — positions arrive in world coordinates from the relay.
import { createElement, sanitizeClipId } from "./svgElement";

const CURSOR_LERP = 0.28;
const CURSOR_STALE_MS = 4000;

type Peer = {
  group: SVGGElement;
  x: number;
  y: number;
  renderX: number;
  renderY: number;
  seenAt: number;
};

export class PeerCursorLayer {
  private readonly peers = new Map<string, Peer>();
  private layer: SVGGElement | null = null;
  private raf: number | null = null;
  private readonly zoom: () => number;

  /** `zoom` reports the camera's current k so chips can counter-scale. */
  constructor(zoom: () => number) {
    this.zoom = zoom;
  }

  /** loadPack swaps the layer element; surviving peers re-attach to it. */
  setLayer(layer: SVGGElement | null): void {
    this.layer = layer;
    if (layer) {
      for (const peer of this.peers.values()) {
        layer.append(peer.group);
      }
    }
  }

  upsert(playerId: string, name: string, avatarUrl: string | null, x: number, y: number): void {
    let peer = this.peers.get(playerId);
    if (!peer || peer.group.dataset.name !== name || peer.group.dataset.avatar !== (avatarUrl ?? "")) {
      peer?.group.remove();
      const group = buildCursorChip(playerId, name, avatarUrl);
      this.layer?.append(group);
      peer = { group, x, y, renderX: x, renderY: y, seenAt: Date.now() };
      this.peers.set(playerId, peer);
      this.startLoop();
    }
    peer.x = x;
    peer.y = y;
    peer.seenAt = Date.now();
  }

  drop(playerId: string): void {
    this.peers.get(playerId)?.group.remove();
    this.peers.delete(playerId);
  }

  dispose(): void {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    for (const peer of this.peers.values()) {
      peer.group.remove();
    }
    this.peers.clear();
  }

  private startLoop(): void {
    if (this.raf !== null) {
      return;
    }
    const step = (): void => {
      const now = Date.now();
      for (const [playerId, peer] of this.peers) {
        if (now - peer.seenAt > CURSOR_STALE_MS) {
          peer.group.remove();
          this.peers.delete(playerId);
          continue;
        }
        peer.renderX += (peer.x - peer.renderX) * CURSOR_LERP;
        peer.renderY += (peer.y - peer.renderY) * CURSOR_LERP;
        // Counter-scale with the camera so chips hold a constant on-screen
        // size — same contract as dot-pack dots — instead of ballooning
        // while zoomed into a dense map.
        peer.group.setAttribute(
          "transform",
          `translate(${peer.renderX} ${peer.renderY}) scale(${(1 / this.zoom()).toFixed(4)})`,
        );
      }
      this.raf = this.peers.size > 0 ? requestAnimationFrame(step) : null;
    };
    this.raf = requestAnimationFrame(step);
  }
}

function buildCursorChip(playerId: string, name: string, avatarUrl: string | null): SVGGElement {
  const group = createElement<SVGGElement>("g");
  group.classList.add("cursor-chip");
  group.dataset.playerId = playerId;
  group.dataset.name = name;
  group.dataset.avatar = avatarUrl ?? "";

  const dotRadius = 11;
  const clipId = `cursor-clip-${sanitizeClipId(playerId)}`;
  if (avatarUrl) {
    const clip = createElement<SVGClipPathElement>("clipPath");
    clip.setAttribute("id", clipId);
    const shape = createElement<SVGCircleElement>("circle");
    shape.setAttribute("r", String(dotRadius));
    clip.append(shape);
    const defs = createElement<SVGElement>("defs");
    defs.append(clip);
    group.append(defs);

    const image = createElement<SVGImageElement>("image");
    image.setAttribute("href", avatarUrl);
    image.setAttribute("x", String(-dotRadius));
    image.setAttribute("y", String(-dotRadius));
    image.setAttribute("width", String(dotRadius * 2));
    image.setAttribute("height", String(dotRadius * 2));
    image.setAttribute("clip-path", `url(#${clipId})`);
    image.setAttribute("preserveAspectRatio", "xMidYMid slice");
    group.append(image);

    const rim = createElement<SVGCircleElement>("circle");
    rim.classList.add("cursor-rim");
    rim.setAttribute("r", String(dotRadius));
    group.append(rim);
  } else {
    const dot = createElement<SVGCircleElement>("circle");
    dot.classList.add("cursor-dot");
    dot.setAttribute("r", String(dotRadius));
    group.append(dot);

    const initial = createElement<SVGTextElement>("text");
    initial.classList.add("cursor-initial");
    initial.setAttribute("text-anchor", "middle");
    initial.setAttribute("dominant-baseline", "central");
    initial.setAttribute("y", "1");
    initial.textContent = (name.trim()[0] ?? "?").toUpperCase();
    group.append(initial);
  }

  const label = createElement<SVGTextElement>("text");
  label.classList.add("cursor-name");
  label.setAttribute("x", String(dotRadius + 5));
  label.setAttribute("y", String(-dotRadius - 2));
  label.textContent = name;
  group.append(label);
  return group;
}
