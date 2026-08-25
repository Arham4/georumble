import type { GameClient, GameState } from "../game/gameClient";
import type { MapPack } from "../../../shared/mappack";
import { normalizeAnswer } from "../../../shared/answers";
import type { MapView } from "../map/mapView";
import { sfx } from "../audio/sfx";
import { accuracyPercent, el, formatClock, setText, type Screen } from "./dom";

export type PlayDeps = {
  mapView: MapView;
  client: GameClient;
  packOf(): MapPack | null;
  /**
   * Runs a named feature through the same click pipeline. Returns false
   * when the guess was swallowed (already found or ruled out) so the field
   * can flash instead of waiting in silence.
   */
  answerSubmit(featureId: string): boolean;
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
  const menuButton = el("button", "btn-ghost menu-btn");
  menuButton.type = "button";
  menuButton.title = "Vote to return to the menu — it happens once everyone votes";
  menuButton.addEventListener("click", () => deps.client.voteLobby());
  const sfxButton = el("button", "btn-ghost sfx-btn");
  sfxButton.type = "button";
  const renderSfx = (): void => {
    sfxButton.textContent = sfx.muted ? "🔇" : "🔊";
    sfxButton.setAttribute("aria-label", sfx.muted ? "Unmute sounds" : "Mute sounds");
  };
  renderSfx();
  sfxButton.addEventListener("click", () => {
    sfx.toggle();
    renderSfx();
  });
  top.append(prompt, stats, menuButton, sfxButton);

  const hintChip = el("div", "hud-hint hidden");
  hintChip.textContent = "Tough one? The answer is outlined on the map.";

  // Type-to-answer: names resolve through the same pipeline as clicks, so
  // aliases and scoring behave identically. A name that matches no feature
  // just shakes the field — no penalty for creative spelling.
  const answerField = el("div", "answer-field");
  const answerInput = document.createElement("input");
  answerInput.type = "text";
  answerInput.placeholder = "…or type the answer";
  answerInput.autocomplete = "off";
  answerInput.spellcheck = false;
  answerInput.enterKeyHint = "done";
  answerInput.maxLength = 64;
  answerInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    const query = normalizeAnswer(answerInput.value);
    if (!query) {
      return;
    }
    const pack = deps.packOf();
    const match = pack?.features.find(
      (feature) =>
        normalizeAnswer(feature.name) === query ||
        (feature.aliases ?? []).some((alias) => normalizeAnswer(alias) === query),
    );
    if (match && deps.answerSubmit(match.id)) {
      answerInput.value = "";
      answerInput.classList.remove("invalid");
    } else {
      answerInput.classList.remove("shake");
      void answerInput.offsetWidth;
      answerInput.classList.add("shake");
    }
  });
  answerField.append(answerInput);

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

  hud.append(top, answerField, hintChip, ticker, zoomControls);
  container.append(hud);

  let lastTarget: string | null = null;
  let lastFoundCount = -1;

  /** Re-run a CSS animation by forcing a reflow between class swaps. */
  function retrigger(node: HTMLElement, className: string): void {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

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

      // Motion cues for the two moments players watch for: a new target
      // sliding in, and the found counter popping when someone scores.
      if (state.target !== lastTarget) {
        lastTarget = state.target;
        retrigger(promptName, "swap");
      }
      if (state.foundIds.length > lastFoundCount && lastFoundCount >= 0) {
        retrigger(foundStat, "pop");
      }
      lastFoundCount = state.foundIds.length;

      const votes = state.lobbyVotes.length;
      const mine = state.you !== null && state.lobbyVotes.includes(state.you);
      menuButton.textContent =
        votes > 0 ? `Menu ${mine ? "✓ " : ""}${votes}/${state.players.length}` : "Menu";
      menuButton.classList.toggle("voted", mine);

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
