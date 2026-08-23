import type { GameClient, GameState } from "../game/gameClient";
import { PACK_MANIFEST, type PackStore } from "../game/packs";
import { el, setText, type Screen } from "./dom";

export type LobbyDeps = {
  client: GameClient;
  store: PackStore;
  /** True inside Discord: your name is your Discord identity, not editable. */
  identityLocked?: boolean;
};

type PackCardRefs = {
  count: HTMLElement | null;
  card: HTMLButtonElement;
};

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

  const playersLabel = el("div", "section-label", "In this room");
  const playerList = el("ul", "player-list");

  const packsLabel = el("div", "section-label", "Pick a map");
  const packGrid = el("div", "pack-grid");
  let selectedPackId = PACK_MANIFEST[0]?.packId ?? null;
  const cards = new Map<string, PackCardRefs>();
  for (const descriptor of PACK_MANIFEST) {
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
      updateStartButton(lastState);
    });
    void deps.store.load(descriptor.packId).then((loaded) => {
      const count = el("div", "pack-count", `${loaded.pack.features.length} regions`);
      card.append(count);
      const refs = cards.get(descriptor.packId);
      if (refs) {
        refs.count = count;
      }
    });
    cards.set(descriptor.packId, { card, count: null });
    packGrid.append(card);
  }

  const startButton = el("button", "btn full");
  startButton.type = "button";
  startButton.addEventListener("click", async () => {
    if (!selectedPackId) {
      return;
    }
    startButton.disabled = true;
    try {
      const loaded = await deps.store.load(selectedPackId);
      deps.client.startGame(loaded.pack);
    } finally {
      updateStartButton(lastState);
    }
  });
  const waitingNote = el("p", "waiting-note hidden");
  waitingNote.textContent = "Only the host can start — nudge them in voice chat.";

  panel.append(
    heading,
    ...nameSection,
    playersLabel,
    playerList,
    packsLabel,
    packGrid,
    startButton,
    waitingNote,
    el("p", "lobby-footer", "Everyone hunts the same region at once. Fewest wrong clicks wins bragging rights."),
  );
  container.append(panel);

  let lastState: GameState | null = null;

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
    startButton.classList.toggle("hidden", !isHost);
    waitingNote.classList.toggle("hidden", isHost);
    startButton.disabled = !selectedPackId;
    const descriptor = selectedPackId ? deps.store.byId(selectedPackId) : null;
    setText(startButton, `Start${descriptor ? ` — ${descriptor.displayName}` : ""}`);
  }

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
      updateStartButton(state);
    },
    destroy(): void {
      panel.remove();
    },
  };
}
