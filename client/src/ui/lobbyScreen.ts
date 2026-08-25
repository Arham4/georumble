import type { GameClient, GameState } from "../game/gameClient";
import { PACK_MANIFEST, type PackStore } from "../game/packs";
import { el, setText, type Screen } from "./dom";
import { createDiscordInviteLink, createGithubLink } from "./linkButtons";

export type LobbyDeps = {
  client: GameClient;
  store: PackStore;
  /** True inside Discord: your name is your Discord identity, not editable. */
  identityLocked?: boolean;
  /** Shown when an embedded Discord sign-in was attempted and failed. */
  signInNotice?: string;
};

type PackCardRefs = {
  count: HTMLElement | null;
  /** Overlapping voter avatars, bottom-right of the card; null while hidden. */
  voters: HTMLElement | null;
  card: HTMLButtonElement;
};

/** Overlapping avatar chips for whoever voted — the social layer of the roll. */
function avatarStack(state: GameState, voterIds: string[]): HTMLElement {
  const stack = el("span", "avatar-stack");
  for (const voterId of voterIds) {
    const player = state.players.find((candidate) => candidate.id === voterId);
    const chip = el("span", "avatar-stack-chip");
    if (player?.avatar) {
      const image = document.createElement("img");
      image.src = player.avatar;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      chip.append(image);
    } else {
      chip.textContent = (player?.name.trim()[0] ?? "?").toUpperCase();
    }
    stack.append(chip);
  }
  return stack;
}

/**
 * Lobby: roster with host marker, data-driven pack picker, and the host-only
 * start control. Non-hosts see a waiting note instead of a dead button.
 */
export function createLobbyScreen(container: HTMLElement, deps: LobbyDeps): Screen {
  const panel = el("div", "panel lobby-panel");

  const heading = el("div", "lobby-head");
  const wordmark = el("h1", "wordmark");
  const geoPart = el("span", undefined, "Geo");
  const rumblePart = el("span", "rumble", "Rumble");
  wordmark.append(geoPart, rumblePart);
  const chip = el("span", "chip");
  heading.append(wordmark, chip);

  const nameLabel = el("div", "section-label", "Your name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 32;
  nameInput.placeholder = "What should the room call you?";
  nameInput.value = deps.client.playerName;
  nameInput.addEventListener("change", () => deps.client.rename(nameInput.value));
  const nameField = el("div", "name-field");
  nameField.append(nameInput);

  // Inside Discord the seat IS your Discord account: show it, don't offer edits.
  const identityRow = el("div", "identity-row");
  const identityAvatar = el("span", "identity-avatar");
  const identityName = el("span", "identity-name");
  const identityTag = el("span", "identity-tag", "via Discord");
  identityRow.append(identityAvatar, identityName, identityTag);
  const avatarUrl = deps.client.playerAvatar;
  if (avatarUrl) {
    const image = document.createElement("img");
    image.src = avatarUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    identityAvatar.append(image);
  } else {
    identityAvatar.textContent = (deps.client.playerName.trim()[0] ?? "?").toUpperCase();
    identityAvatar.classList.add("initial");
  }
  identityName.textContent = deps.client.playerName;
  const nameSection: HTMLElement[] = deps.identityLocked
    ? [identityRow]
    : [nameLabel, nameField];
  const signInWarning = deps.signInNotice ? el("p", "lobby-warning", deps.signInNotice) : null;

  const playersLabel = el("div", "section-label", "In this room");
  const playerList = el("ul", "player-list");

  // Packs render as labeled sections inside one scrollable area, so the
  // picker scales to dozens of packs while Start stays on screen.
  const GROUP_LABELS: Record<string, string> = {
    countries: "Countries",
    usa: "USA",
    world: "World",
  };
  const packsLabel = el("div", "section-label", "Pick a map");
  const packScroller = el("div", "pack-scroller");
  let selectedPackId = PACK_MANIFEST[0]?.packId ?? null;
  const cards = new Map<string, PackCardRefs>();
  const groups = new Map<string, string[]>();
  for (const descriptor of PACK_MANIFEST) {
    const ids = groups.get(descriptor.group) ?? [];
    ids.push(descriptor.packId);
    groups.set(descriptor.group, ids);
  }
  for (const [group, packIds] of groups) {
    packScroller.append(el("div", "pack-group-label", GROUP_LABELS[group] ?? group));
    const packGrid = el("div", "pack-grid");
    for (const packId of packIds) {
      const descriptor = PACK_MANIFEST.find((candidate) => candidate.packId === packId)!;
      const card = el("button", "pack-card");
      card.type = "button";
      const name = el("div", "pack-name", descriptor.displayName);
      const blurb = el("div", "pack-blurb", descriptor.blurb);
      card.append(name, blurb);
      if (selectedPackId === descriptor.packId) {
        card.classList.add("selected");
      }
      card.addEventListener("click", () => {
        selectedPackId = descriptor.packId;
        for (const [id, refs] of cards) {
          refs.card.classList.toggle("selected", id === selectedPackId);
        }
        // Everyone nominates, not just the host: the roll weights each pick
        // as one ticket, so consensus raises odds without stealing the choice.
        deps.client.votePack(descriptor.packId);
        updateStartButton(lastState);
      });
      void deps.store
        .load(descriptor.packId)
        .then((loaded) => {
          const count = el("div", "pack-count", `${loaded.pack.features.length} regions`);
          card.append(count);
          const refs = cards.get(descriptor.packId);
          if (refs) {
            refs.count = count;
          }
        })
        .catch(() => {
          // Counts are decoration; the Start path surfaces load failures.
        });
      cards.set(descriptor.packId, { card, count: null, voters: null });
      packGrid.append(card);
    }
    packScroller.append(packGrid);
  }

  const startButton = el("button", "btn full");
  startButton.type = "button";
  const startWith = async (packId: string): Promise<void> => {
    const loaded = await deps.store.load(packId);
    deps.client.startGame(loaded.pack, hintsCheck.checked);
  };
  // Host's call: some rooms want the hint chip, purists want the raw map.
  const hintsToggle = el("label", "hint-toggle");
  const hintsCheck = document.createElement("input");
  hintsCheck.type = "checkbox";
  hintsCheck.checked = true;
  hintsToggle.append(hintsCheck, el("span", undefined, "Show hints after 3 misses"));
  startButton.addEventListener("click", async () => {
    if (!selectedPackId) {
      return;
    }
    startButton.disabled = true;
    try {
      await startWith(selectedPackId);
    } finally {
      updateStartButton(lastState);
    }
  });
  // Decision fatigue is real with a dozen packs: one click rolls the whole
  // manifest and starts. The card highlight shows what came up.
  const randomButton = el("button", "btn btn-ghost full");
  randomButton.type = "button";
  randomButton.textContent = "🎲 Random map";
  randomButton.addEventListener("click", () => {
    const pick = PACK_MANIFEST[Math.floor(Math.random() * PACK_MANIFEST.length)];
    if (!pick) {
      return;
    }
    selectedPackId = pick.packId;
    for (const [id, refs] of cards) {
      refs.card.classList.toggle("selected", id === selectedPackId);
    }
    void startWith(pick.packId);
  });
  const waitingNote = el("p", "waiting-note hidden");
  waitingNote.textContent = "Pick a map — when everyone has (or time runs out), one wins at random.";
  const rollBanner = el("p", "roll-banner hidden");

  panel.append(
    heading,
    ...(signInWarning ? [signInWarning] : []),
    ...nameSection,
    playersLabel,
    playerList,
    packsLabel,
    packScroller,
    rollBanner,
    hintsToggle,
    startButton,
    randomButton,
    waitingNote,
    createDiscordInviteLink(),
    el("p", "lobby-footer", "Everyone hunts the same region at once. Fewest wrong clicks wins bragging rights."),
  );
  container.append(panel);
  const githubLink = createGithubLink();
  container.append(githubLink);

  let lastState: GameState | null = null;
  let prevChosenPackId: string | null = null;
  let lastDeadline: number | null = null;
  let resolveSent = false;
  let overlay: HTMLElement | null = null;
  let rollTimers: ReturnType<typeof setTimeout>[] = [];

  function clearRollTimers(): void {
    for (const timer of rollTimers) {
      clearTimeout(timer);
    }
    rollTimers = [];
  }

  /** Live countdown on the banner; fires the relay nudge once at expiry. */
  function tickRoll(): void {
    const state = lastState;
    if (!state || state.phase !== "lobby" || state.chosenPackId || state.packVoteDeadline === null) {
      return;
    }
    const remaining = state.packVoteDeadline - (Date.now() + (state.clockOffsetMs ?? 0));
    if (remaining <= 0) {
      rollBanner.textContent = "🎲 Rolling the map…";
      if (!resolveSent) {
        resolveSent = true;
        deps.client.resolvePackVotes();
      }
      return;
    }
    const voted = Object.keys(state.packVotes ?? {}).length;
    rollBanner.textContent = `🎲 Rolling in ${Math.ceil(remaining / 1000)}s — ${voted}/${state.players.length} picked`;
  }

  /**
   * The reveal: every nominated map on screen, a highlight sweeping them
   * slot-machine style before landing on the relay's pick. Everyone sees the
   * same winner because the roll happened server-side; the host then starts
   * it a beat later so the moment lands before the map appears.
   */
  function showReveal(
    chosenPackId: string,
    votes: Record<string, string>,
    state: GameState,
  ): void {
    const candidates = [...new Set(Object.values(votes))];
    const entries = candidates.map((id) => ({
      id,
      name: PACK_MANIFEST.find((pack) => pack.packId === id)?.displayName ?? id,
      voters: Object.entries(votes)
        .filter(([, voted]) => voted === id)
        .map(([playerId]) => playerId),
    }));
    const winnerIndex = Math.max(0, candidates.indexOf(chosenPackId));
    overlay = el("div", "roll-overlay");
    const revealPanel = el("div", "roll-panel");
    const chips = el("div", "roll-chips");
    const chipEls = entries.map((entry) => {
      const chip = el("span", "roll-chip");
      chip.append(el("span", "roll-chip-name", entry.name), avatarStack(state, entry.voters));
      return chip;
    });
    chips.append(...chipEls);
    const reveal = el("div", "roll-reveal");
    revealPanel.append(el("div", "section-label", "The map decides itself"), chips, reveal);
    overlay.append(revealPanel);
    container.append(overlay);

    const base = Math.min(26, 10 + entries.length * 3);
    // The sweep must decelerate ONTO the winner — landing anywhere else and
    // jumping reads as rigged. Extend the run so the final highlight is
    // naturally the winner's index.
    const ticks =
      base + ((winnerIndex - ((base - 1) % entries.length)) + entries.length) % entries.length;
    let tick = 0;
    let delay = 70;
    const step = (): void => {
      chipEls.forEach((chip, i) => chip.classList.toggle("hot", i === tick % entries.length));
      tick += 1;
      if (tick < ticks) {
        delay *= 1.14;
        rollTimers.push(setTimeout(step, delay));
        return;
      }
      chipEls.forEach((chip, i) => chip.classList.toggle("hot", i === winnerIndex));
      reveal.textContent = `🗺️ ${entries[winnerIndex]?.name ?? chosenPackId}`;
      reveal.classList.add("visible");
      if (lastState?.isHost) {
        rollTimers.push(
          setTimeout(() => {
            void deps.store
              .load(chosenPackId)
              .then((loaded) => deps.client.startGame(loaded.pack, hintsCheck.checked))
              .catch(() => {
                // Load failed: the room stays in the lobby, Start still works.
              });
          }, 1100),
        );
      }
    };
    step();
  }

  function renderPlayers(state: GameState): void {
    playerList.replaceChildren(
      ...state.players.map((player) => {
        const row = el("li", "player-row");
        if (player.isHost) {
          row.append(el("span", "crown", "♛"));
        }
        const avatar = el("span", "player-avatar");
        if (player.avatar) {
          const image = document.createElement("img");
          image.src = player.avatar;
          image.alt = "";
          image.referrerPolicy = "no-referrer";
          avatar.append(image);
        } else {
          avatar.textContent = (player.name.trim()[0] ?? "?").toUpperCase();
          avatar.classList.add("initial");
        }
        row.append(avatar, el("span", undefined, player.name));
        if (player.isYou) {
          row.append(el("span", "you-tag", "YOU"));
        }
        return row;
      }),
    );
  }

  function updateStartButton(state: GameState | null): void {
    const isHost = state?.isHost ?? false;
    const chosen = state?.chosenPackId ?? null;
    // Once the roll lands, the reveal auto-starts the game — direct controls
    // would only fight it.
    startButton.classList.toggle("hidden", !isHost || chosen !== null);
    randomButton.classList.toggle("hidden", !isHost || chosen !== null);
    hintsToggle.classList.toggle("hidden", !isHost || chosen !== null);
    waitingNote.classList.toggle("hidden", isHost || chosen !== null);
    startButton.disabled = !selectedPackId;
    const descriptor = selectedPackId ? deps.store.byId(selectedPackId) : null;
    setText(startButton, `Start${descriptor ? ` — ${descriptor.displayName}` : ""}`);
  }

  const rollTimer = setInterval(() => tickRoll(), 400);

  return {
    update(state: GameState): void {
      lastState = state;
      const solo = state.connectionKind === "local";
      chip.classList.toggle("solo", solo);
      chip.classList.toggle("live", !solo && state.phase !== "boot");
      setText(chip, solo ? "Solo room" : "Live room");
      renderPlayers(state);
      if (!deps.identityLocked && document.activeElement !== nameInput) {
        nameInput.value = deps.client.playerName;
      }
      // Nomination stacks, roll countdown, and the reveal all hang off relay
      // state so every client sees the same story.
      const votes = state.packVotes ?? {};
      for (const [packId, refs] of cards) {
        const voters = Object.entries(votes)
          .filter(([, voted]) => voted === packId)
          .map(([playerId]) => playerId);
        if (voters.length === 0) {
          refs.voters?.remove();
          refs.voters = null;
        } else {
          if (!refs.voters) {
            refs.voters = el("span", "pack-voters");
            refs.card.append(refs.voters);
          }
          refs.voters.replaceChildren(...avatarStack(state, voters).childNodes);
        }
        // Amber tint: someone wants this map, but you haven't picked it.
        refs.card.classList.toggle(
          "voted-elsewhere",
          voters.length > 0 && votes[state.you ?? ""] !== packId,
        );
      }
      const chosen = state.chosenPackId;
      if (chosen !== prevChosenPackId) {
        if (chosen) {
          clearRollTimers();
          showReveal(chosen, votes, state);
        }
        prevChosenPackId = chosen;
      }
      if (chosen) {
        rollBanner.classList.add("hidden");
      } else if (state.packVoteDeadline !== null) {
        if (state.packVoteDeadline !== lastDeadline) {
          lastDeadline = state.packVoteDeadline;
          resolveSent = false;
        }
        rollBanner.classList.remove("hidden");
        tickRoll();
      } else {
        lastDeadline = null;
        resolveSent = false;
        rollBanner.classList.add("hidden");
      }
      updateStartButton(state);
    },
    destroy(): void {
      clearInterval(rollTimer);
      clearRollTimers();
      overlay?.remove();
      githubLink.remove();
      panel.remove();
    },
  };
}
