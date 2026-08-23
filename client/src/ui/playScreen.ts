import type { GameState } from "../game/gameClient";
import type { MapPack } from "../../../shared/mappack";
import type { MapView } from "../map/mapView";
import { accuracyPercent, el, formatClock, setText, type Screen } from "./dom";

export type PlayDeps = {
  mapView: MapView;
  packOf(): MapPack | null;
};

/**
 * Playing HUD: shared prompt banner with the headline numbers (found, time,
 * accuracy), hint chip after repeated misses, recent-hits ticker, zoom pad.
 * The map itself fills the screen behind it.
 */
export function createPlayScreen(container: HTMLElement, deps: PlayDeps): Screen {
  const hud = el("div", "hud");

  const top = el("div", "hud-top");
  const prompt = el("div", "prompt");
  prompt.append(el("span", "prompt-label", "Find"));
  const promptName = el("span", "prompt-name", "…");
  prompt.append(promptName);
  const stats = el("div", "hud-stats");
  const foundStat = el("span", "stat found-stat");
  const timeStat = el("span", "stat time");
  const accuracyStat = el("span", "stat bad");
  stats.append(foundStat, timeStat, accuracyStat);
  top.append(prompt, stats);

  const hintChip = el("div", "hud-hint hidden");
  hintChip.textContent = "Tough one? The answer is outlined on the map.";

  const ticker = el("div", "hud-ticker");

  const zoomControls = el("div", "zoom-controls");
  const zoomIn = el("button");
  zoomIn.type = "button";
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "Zoom in");
  const zoomOut = el("button");
  zoomOut.type = "button";
  zoomOut.textContent = "−";
  zoomOut.setAttribute("aria-label", "Zoom out");
  const zoomReset = el("button");
  zoomReset.type = "button";
  zoomReset.textContent = "⌂";
  zoomReset.setAttribute("aria-label", "Reset view");
  zoomIn.addEventListener("click", () => deps.mapView.zoomStep(1.5));
  zoomOut.addEventListener("click", () => deps.mapView.zoomStep(1 / 1.5));
  zoomReset.addEventListener("click", () => deps.mapView.resetView());
  zoomControls.append(zoomIn, zoomOut, zoomReset);

  hud.append(top, hintChip, ticker, zoomControls);
  container.append(hud);

  function featureName(pack: MapPack | null, id: string): string {
    return pack?.features.find((feature) => feature.id === id)?.name ?? id;
  }

  function playerName(state: GameState, id: string): string {
    return state.players.find((player) => player.id === id)?.name ?? "Someone";
  }

  return {
    update(state: GameState): void {
      const pack = deps.packOf();
      setText(promptName, state.target !== null ? featureName(pack, state.target) : "…");
      setText(foundStat, `${state.foundIds.length} / ${state.orderLength}`);
      setText(timeStat, formatClock(state.elapsedSeconds));
      const attempts = state.correct + state.misses;
      setText(accuracyStat, accuracyPercent(state.correct, attempts));
      accuracyStat.classList.toggle("bad", attempts === 0 || state.correct < state.misses);
      accuracyStat.classList.toggle("good", attempts > 0 && state.correct >= state.misses);
      hintChip.classList.toggle("hidden", !state.hintActive);

      ticker.replaceChildren(
        ...state.ticker.map((entry) => {
          const row = el(
            "div",
            `ticker-row ${entry.correct ? "good" : "bad"}`,
          );
          const who = el("span", "who", playerName(state, entry.byPlayer));
          const what = el(
            "span",
            "what",
            entry.correct
              ? ` found ${featureName(pack, entry.featureId)}`
              : ` missed on ${featureName(pack, entry.featureId)}`,
          );
          row.append(who, what);
          return row;
        }),
      );
    },
    destroy(): void {
      hud.remove();
    },
  };
}
