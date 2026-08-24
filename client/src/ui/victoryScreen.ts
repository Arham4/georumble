import type { GameClient, GameState } from "../game/gameClient";
import { accuracyPercent, el, formatClock, setText, type Screen } from "./dom";

export type VictoryDeps = {
  client: GameClient;
  restart(): Promise<void>;
  /** Host-only: return the room to the lobby so any pack can be picked. */
  changeMap(): void;
};

function scoreRow(state: GameState, index: number): HTMLElement {
  const row = state.scoreboard[index];
  const rowEl = el("li", "score-row");
  if (row.isYou) {
    rowEl.classList.add("you");
  }
  const avatar = el("span", "score-avatar");
  if (row.avatar) {
    const image = document.createElement("img");
    image.src = row.avatar;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    avatar.append(image);
  } else {
    avatar.textContent = (row.name.trim()[0] ?? "?").toUpperCase();
    avatar.classList.add("initial");
  }
  const name = el("span", "score-name", `${row.name}${row.isYou ? " (you)" : ""}`);
  const stats = el("span", "score-stats");
  const total = row.correct + row.misses;
  stats.append(
    el("span", "score-detail", `${row.correct}/${total} found`),
    el("span", "score-accuracy", accuracyPercent(row.correct, total)),
  );
  rowEl.append(avatar, name, stats);
  return rowEl;
}

/**
 * Victory: the genre's two headline numbers (time + accuracy) plus total
 * guesses, a per-player scoreboard, and a host-only play-again that
 * reshuffles the same pack.
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

  const scoreboardLabel = el("div", "section-label", "Who carried");
  const scoreList = el("ul", "score-list");

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
  const mapButton = el("button", "btn btn-ghost full");
  mapButton.type = "button";
  mapButton.textContent = "Change map";
  mapButton.addEventListener("click", () => deps.changeMap());

  panel.append(
    title,
    sub,
    grid,
    scoreboardLabel,
    scoreList,
    againButton,
    mapButton,
    waitingNote,
  );
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
      const ranked = state.scoreboard
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.correct + row.misses > 0)
        // Carrying is volume first: one lucky hit must not outrank someone
        // who grinded the map; accuracy breaks ties among equals.
        .sort(
          (a, b) =>
            b.row.correct - a.row.correct ||
            b.row.correct / (b.row.correct + b.row.misses) -
              a.row.correct / (a.row.correct + a.row.misses),
        );
      scoreList.replaceChildren(...ranked.map(({ index }) => scoreRow(state, index)));
      scoreboardLabel.classList.toggle("hidden", solo || ranked.length === 0);
      scoreList.classList.toggle("hidden", solo || ranked.length === 0);
      againButton.classList.toggle("hidden", !state.isHost);
      mapButton.classList.toggle("hidden", !state.isHost);
      waitingNote.classList.toggle("hidden", state.isHost);
    },
    destroy(): void {
      panel.remove();
    },
  };
}
