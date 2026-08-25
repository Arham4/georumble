import type { GameState } from "../game/gameClient";

// Victory carry wheel: each player's slice is their share of the team's
// finds, and one weighted spin crowns whoever lands under the pointer.
// Pure spectacle — the scoreboard above stays the honest ranking.
const SIZE = 240;
const RADIUS = SIZE / 2 - 10;
const CENTER = SIZE / 2;
const TAU = Math.PI * 2;
const START = -Math.PI / 2;
const SPIN_TURNS = 4;
const SPIN_MS = 3800;
const LABEL_MIN_SLICE = 0.32;
const COLORS = [
  "#5865f2",
  "#248046",
  "#8f7d2c",
  "#a34f42",
  "#7c5cbf",
  "#2d7d8f",
  "#b3558a",
  "#5b8c3e",
];

const SVG_NS = "http://www.w3.org/2000/svg";

type Slice = {
  name: string;
  initial: string;
  start: number;
  end: number;
  color: string;
};

type Wheel = {
  element: HTMLElement;
  update(state: GameState): void;
  destroy(): void;
};

function polar(angle: number, radius: number): [number, number] {
  return [CENTER + radius * Math.cos(angle), CENTER + radius * Math.sin(angle)];
}

function slicePath(start: number, end: number): string {
  const [x1, y1] = polar(start, RADIUS);
  const [x2, y2] = polar(end, RADIUS);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

export function createCarryWheel(): Wheel {
  const holder = document.createElement("div");
  holder.className = "carry-wheel hidden";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute("width", String(SIZE));
  svg.setAttribute("height", String(SIZE));
  const wheel = document.createElementNS(SVG_NS, "g");
  const pointer = document.createElementNS(SVG_NS, "path");
  pointer.classList.add("carry-pointer");
  pointer.setAttribute("d", `M ${CENTER - 8} 2 L ${CENTER + 8} 2 L ${CENTER} 16 Z`);
  svg.append(wheel, pointer);

  const result = document.createElement("div");
  result.className = "carry-result";

  const spinButton = document.createElement("button");
  spinButton.type = "button";
  spinButton.className = "btn btn-ghost hidden";
  spinButton.textContent = "Spin again";
  spinButton.addEventListener("click", () => spin());

  holder.append(svg, result, spinButton);

  let slices: Slice[] = [];
  let signature = "";
  let rotation = 0;
  let spinning = false;
  let raf: number | null = null;

  function apply(): void {
    wheel.setAttribute(
      "transform",
      `rotate(${((rotation * 180) / Math.PI).toFixed(2)} ${CENTER} ${CENTER})`,
    );
  }

  function buildSlices(rows: GameState["scoreboard"]): void {
    slices = [];
    wheel.replaceChildren();
    const weights = rows.map((row) => Math.max(row.correct, 0));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let angle = START;
    rows.forEach((row, index) => {
      const share = total === 0 ? 1 / rows.length : weights[index] / total;
      const end = index === rows.length - 1 ? START + TAU : angle + share * TAU;
      const slice: Slice = {
        name: row.name,
        initial: (row.name.trim()[0] ?? "?").toUpperCase(),
        start: angle,
        end,
        color: COLORS[index % COLORS.length],
      };
      slices.push(slice);
      const path = document.createElementNS(SVG_NS, "path");
      path.classList.add("carry-slice");
      path.setAttribute("d", slicePath(slice.start, slice.end));
      path.setAttribute("fill", slice.color);
      wheel.append(path);
      if (slice.end - slice.start >= LABEL_MIN_SLICE) {
        const [x, y] = polar((slice.start + slice.end) / 2, RADIUS * 0.62);
        const label = document.createElementNS(SVG_NS, "text");
        label.classList.add("carry-slice-label");
        label.setAttribute("x", x.toFixed(1));
        label.setAttribute("y", y.toFixed(1));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "central");
        label.textContent = slice.initial;
        wheel.append(label);
      }
      angle = end;
    });
    apply();
  }

  /** Weighted by geometry: a uniform angle lands in a slice with its odds. */
  function pickByAngle(): Slice {
    let angle = START + Math.random() * TAU;
    if (angle >= START + TAU) {
      angle -= TAU;
    }
    for (const slice of slices) {
      if (angle >= slice.start && angle < slice.end) {
        return slice;
      }
    }
    return slices[slices.length - 1];
  }

  function spin(): void {
    if (spinning || slices.length === 0) {
      return;
    }
    spinning = true;
    result.classList.remove("visible");
    spinButton.disabled = true;

    const winner = pickByAngle();
    const mid = (winner.start + winner.end) / 2;
    const current = ((rotation % TAU) + TAU) % TAU;
    let delta = (START - mid - current) % TAU;
    if (delta < 0) {
      delta += TAU;
    }
    const from = rotation;
    const to = rotation + SPIN_TURNS * TAU + delta;
    const startedAt = performance.now();

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / SPIN_MS);
      rotation = from + (to - from) * (1 - Math.pow(1 - progress, 3));
      apply();
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
        return;
      }
      spinning = false;
      spinButton.disabled = false;
      spinButton.classList.remove("hidden");
      result.textContent = `👑 ${winner.name} carried the team!`;
      result.classList.add("visible");
    };
    raf = requestAnimationFrame(tick);
  }

  return {
    element: holder,
    update(state: GameState): void {
      const multi = state.players.length > 1;
      holder.classList.toggle("hidden", !multi);
      if (!multi) {
        return;
      }
      const next = state.scoreboard.map((row) => `${row.id}:${row.correct}`).join("|");
      if (next === signature) {
        return;
      }
      signature = next;
      buildSlices(state.scoreboard);
      result.classList.remove("visible");
      spinButton.classList.add("hidden");
      // First paint of the victory screen spins by itself; the button is
      // there because watching a wheel once is never enough.
      setTimeout(() => spin(), 800);
    },
    destroy(): void {
      if (raf !== null) {
        cancelAnimationFrame(raf);
      }
      holder.remove();
    },
  };
}
