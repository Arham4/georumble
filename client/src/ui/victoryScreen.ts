import type { GameClient, GameState } from "../game/gameClient";
import { accuracyPercent, el, formatClock, setText, type Screen } from "./dom";
import { createCarryWheel } from "./carryWheel";
import { launchConfetti } from "./confetti";
import { sfx } from "../audio/sfx";

const BEST_PREFIX = "georumble:best:";

function loadBest(packId: string): number | null {
  try {
    const stored = localStorage.getItem(BEST_PREFIX + packId);
    return stored === null ? null : Number(stored);
  } catch {
    return null;
  }
}

function saveBest(packId: string, seconds: number): void {
  try {
    localStorage.setItem(BEST_PREFIX + packId, String(seconds));
  } catch {
    // A full/private storage mode just means no personal bests.
  }
}

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
  launchConfetti();
  sfx.win();
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
  const carry = createCarryWheel();
  const bestLine = el("p", "victory-best");
  let bestRecorded = false;
  let bestImproved = false;
  let bestSeconds: number | null = null;

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
  // Non-hosts have no direct way back to the picker; the same unanimous vote
  // as mid-game works here, so nobody waits on an absent host.
  const voteButton = el("button", "btn btn-ghost full");
  voteButton.type = "button";
  voteButton.addEventListener("click", () => deps.client.voteLobby());

  panel.append(
    title,
    sub,
    grid,
    bestLine,
    scoreboardLabel,
    scoreList,
    carry.element,
    againButton,
    mapButton,
    voteButton,
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
      // Personal best: recorded once per victory from the relay-stamped time.
      if (!bestRecorded && state.win && state.packId) {
        bestRecorded = true;
        const previous = loadBest(state.packId);
        bestImproved = previous === null || seconds < previous;
        if (bestImproved) {
          saveBest(state.packId, seconds);
          bestSeconds = seconds;
        } else {
          bestSeconds = previous;
        }
      }
      if (bestRecorded && bestSeconds !== null) {
        setText(
          bestLine,
          bestImproved
            ? `⚡ New personal best — ${formatClock(seconds)}!`
            : `Personal best: ${formatClock(bestSeconds)}`,
        );
        bestLine.classList.remove("hidden");
      } else {
        bestLine.classList.add("hidden");
      }
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
      carry.update(state);
      againButton.classList.toggle("hidden", !state.isHost);
      mapButton.classList.toggle("hidden", !state.isHost);
      const votes = state.lobbyVotes.length;
      const mine = state.you !== null && state.lobbyVotes.includes(state.you);
      voteButton.textContent =
        votes > 0
          ? `Vote for the menu ${mine ? "✓ " : ""}${votes}/${state.players.length}`
          : "Vote for the menu";
      voteButton.classList.toggle("voted", mine);
      voteButton.classList.toggle("hidden", state.isHost);
      waitingNote.classList.toggle("hidden", state.isHost || votes > 0);
    },
    destroy(): void {
      carry.destroy();
      panel.remove();
    },
  };
}
