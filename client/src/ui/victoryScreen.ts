import type { GameClient, GameState } from "../game/gameClient";
import { accuracyPercent, el, formatClock, setText, type Screen } from "./dom";

export type VictoryDeps = {
  client: GameClient;
  restart(): Promise<void>;
};

/**
 * Victory: the genre's two headline numbers (time + accuracy) plus total
 * guesses, with a host-only play-again that reshuffles the same pack.
 */
export function createVictoryScreen(container: HTMLElement, deps: VictoryDeps): Screen {
  const panel = el("div", "panel victory-panel");
  const title = el("h2", "victory-title", "Map cleared!");
  const sub = el("p", "victory-sub");

  const grid = el("div", "stat-grid");
  const timeValue = el("div", "value");
  const timeCell = el("div", "stat-cell");
  timeCell.append(timeValue, el("div", "label", "Time"));
  const guessValue = el("div", "value");
  const guessCell = el("div", "stat-cell");
  guessCell.append(guessValue, el("div", "label", "Guesses"));
  const accuracyValue = el("div", "value");
  const accuracyCell = el("div", "stat-cell");
  accuracyCell.append(accuracyValue, el("div", "label", "Accuracy"));
  grid.append(timeCell, guessCell, accuracyCell);

  let restarting = false;
  const againButton = el("button", "btn full");
  againButton.type = "button";
  againButton.textContent = "Play again";
  againButton.addEventListener("click", async () => {
    if (restarting) {
      return;
    }
    restarting = true;
    againButton.disabled = true;
    try {
      await deps.restart();
    } finally {
      restarting = false;
      againButton.disabled = false;
    }
  });
  const waitingNote = el("p", "waiting-note hidden");
  waitingNote.textContent = "Ask the host to run it back.";

  panel.append(title, sub, grid, againButton, waitingNote);
  container.append(panel);

  return {
    update(state: GameState): void {
      const seconds = state.win?.seconds ?? state.elapsedSeconds;
      setText(timeValue, formatClock(seconds));
      setText(guessValue, String(state.win?.guesses ?? state.correct + state.misses));
      setText(
        accuracyValue,
        accuracyPercent(state.correct, state.correct + state.misses),
      );
      const solo = state.players.length <= 1;
      setText(
        sub,
        solo
          ? "Solo run complete. Try beating this time."
          : `${state.players.map((player) => player.name).join(", ")} cleared it together.`,
      );
      againButton.classList.toggle("hidden", !state.isHost);
      waitingNote.classList.toggle("hidden", state.isHost);
    },
    destroy(): void {
      panel.remove();
    },
  };
}
