import "./theme.css";
import type { GuessOutcome } from "../../shared/protocol";
import { GameClient, type GameState } from "./game/gameClient";
import { PackStore, type LoadedPack } from "./game/packs";
import { MapView } from "./map/mapView";
import type { CloseInfo, ConnectionHandlers } from "./net/connection";
import { LocalConnection } from "./net/localConnection";
import { newRoomCode, normalizeJoinCode } from "./net/openRooms";
import { SocketConnection } from "./net/socketConnection";
import { el, type Screen } from "./ui/dom";
import { createLobbyScreen } from "./ui/lobbyScreen";
import { createPlayScreen } from "./ui/playScreen";
import { createVictoryScreen } from "./ui/victoryScreen";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
const NAME_STORAGE_KEY = "georumble:name";
const ID_STORAGE_KEY = "georumble:userId";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_ATTEMPTS = 6;
// Capacity/admission refusals are answers, not accidents; never retry them.
const FATAL_CLOSE_CODES = new Set([1000, 4002, 4003, 4004]);
const NAME_REVEAL_MS = 1100;

type Identity = {
  userId: string;
  name: string;
  avatar: string | null;
  instanceId: string | null;
  embedded: boolean;
};

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null | undefined;
  avatar?: string | null | undefined;
};

type AuthenticateShape = {
  user: DiscordUser;
};

function discordAvatarUrl(userId: string, avatarHash: string): string {
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=64`;
}

function guestIdentity(): Identity {
  let userId = localStorage.getItem(ID_STORAGE_KEY);
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem(ID_STORAGE_KEY, userId);
  }
  return {
    userId,
    name: localStorage.getItem(NAME_STORAGE_KEY) ?? "",
    avatar: null,
    instanceId: null,
    embedded: window.self !== window.top,
  };
}

/**
 * Full handshake only inside a Discord activity iframe; plain-browser dev
 * runs as a guest without touching the SDK.
 */
async function resolveIdentity(): Promise<Identity> {
  const fallback = guestIdentity();
  const embedded = window.self !== window.top;
  if (!CLIENT_ID || !embedded) {
    return fallback;
  }
  try {
    const { DiscordSDK } = await import("@discord/embedded-app-sdk");
    const sdk = new DiscordSDK(CLIENT_ID);
    await sdk.ready();
    const { code } = await sdk.commands.authorize({
      client_id: CLIENT_ID,
      scope: ["identify"],
      prompt: "none",
    });
    const tokenResponse = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`token exchange failed (HTTP ${tokenResponse.status})`);
    }
    const { access_token } = (await tokenResponse.json()) as { access_token: string };
    // Response schema drifts between SDK majors; read only the fields we need.
    const auth = (await sdk.commands.authenticate({ access_token })) as AuthenticateShape;
    localStorage.setItem(NAME_STORAGE_KEY, auth.user.global_name ?? auth.user.username);
    return {
      userId: auth.user.id,
      name: auth.user.global_name ?? auth.user.username,
      avatar: auth.user.avatar ? discordAvatarUrl(auth.user.id, auth.user.avatar) : null,
      instanceId: sdk.instanceId,
      embedded: true,
    };
  } catch {
    return fallback;
  }
}

async function boot(): Promise<void> {
  console.log(`[georumble] build ${__BUILD_ID__}`);
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point missing");
  }
  const mapHolder = el("div", "map-holder");
  const screenHolder = el("div", "screen-holder");
  const toastHolder = el("div", "toast-holder");
  app.replaceChildren(mapHolder, screenHolder, toastHolder);

  const identity = await resolveIdentity();
  const store = new PackStore();
  const mapView = new MapView(mapHolder);

  let currentPack: LoadedPack | null = null;
  let packOfScreen: string | null = null;
  let currentPhase = "";
  let currentScreen: Screen | null = null;
  let lastState: GameState | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let nameRevealTimer: ReturnType<typeof setTimeout> | null = null;
  let prevPlayerIds = new Set<string>();
  // Discord instances own the room decision outright; browser sessions may opt
  // into an online room only via a well-formed code in the URL. An embedded
  // frame with no instance stays solo rather than showing browser-only UI
  // inside someone's voice channel.
  const joinCode =
    !identity.instanceId && !identity.embedded
      ? normalizeJoinCode(new URLSearchParams(window.location.search).get("room"))
      : null;
  const startOnline = identity.instanceId !== null || joinCode !== null;
  let mode: "socket" | "local" = startOnline ? "socket" : "local";

  const clickLabel = el("div", "click-label");
  mapHolder.append(clickLabel);

  const showToast = (state: GameState): void => {
    toastHolder.replaceChildren();
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (!state.notice) {
      return;
    }
    const toast = el("div", `toast ${state.notice.kind}`, state.notice.text);
    toastHolder.append(toast);
    toastTimer = setTimeout(() => toast.remove(), 4200);
  };

  function mountScreen(state: GameState): void {
    currentScreen?.destroy();
    currentPhase = state.phase;
    switch (state.phase) {
      case "lobby":
        currentScreen = createLobbyScreen(screenHolder, {
          client,
          store,
          identityLocked: identity.instanceId !== null,
        });
        break;
      case "playing":
        currentScreen = createPlayScreen(screenHolder, {
          mapView,
          packOf: () => currentPack?.pack ?? null,
        });
        break;
      case "victory":
        currentScreen = createVictoryScreen(screenHolder, {
          client,
          restart: restartGame,
        });
        break;
      case "boot":
        currentScreen = {
          update: () => undefined,
          destroy: () => bootPanel.remove(),
        };
        break;
    }
    if (state.phase === "boot") {
      screenHolder.append(bootPanel);
    }
    currentScreen?.update(state);
  }

  async function ensurePack(packId: string | null): Promise<void> {
    if (!packId || packOfScreen === packId) {
      return;
    }
    try {
      currentPack = await store.load(packId);
      mapView.loadPack(currentPack.pack, currentPack.topo);
      packOfScreen = packId;
      currentScreen?.update(lastState ?? stateOf());
    } catch {
      currentPack = null;
      const failedToast = el("div", "toast error", "Map pack failed to load");
      toastHolder.append(failedToast);
      setTimeout(() => failedToast.remove(), 4200);
    }
  }

  function stateOf(): GameState {
    return (
      lastState ?? {
        phase: "boot",
        connectionKind: null,
        you: null,
        name: identity.name,
        players: [],
        isHost: false,
        packId: null,
        orderLength: 0,
        foundIds: [],
        target: null,
        elapsedSeconds: 0,
        correct: 0,
        misses: 0,
        missesByRegion: {},
        hintActive: false,
        ticker: [],
        win: null,
        scoreboard: [],
        notice: null,
      }
    );
  }

  async function restartGame(): Promise<void> {
    const packId = lastState?.packId;
    if (!packId) {
      return;
    }
    const loaded = await store.load(packId);
    client.startGame(loaded.pack);
  }

  const onVerdict = (outcome: GuessOutcome): void => {
    if (outcome.correct) {
      mapView.flashCorrect(outcome.featureId);
    } else {
      mapView.flashMiss(outcome.featureId);
    }
  };

  const handleState = (state: GameState): void => {
    lastState = state;
    if (state.name) {
      localStorage.setItem(NAME_STORAGE_KEY, state.name);
    }
    void ensurePack(state.packId);
    mapView.setFound(state.foundIds, state.missesByRegion);
    mapView.setTarget(state.target);
    mapView.setHint(state.hintActive);
    mapView.setInteractive(state.phase === "playing");
    const nextIds = new Set(state.players.map((player) => player.id));
    for (const playerId of prevPlayerIds) {
      if (!nextIds.has(playerId)) {
        mapView.dropPeerCursor(playerId);
      }
    }
    prevPlayerIds = nextIds;
    if (state.phase === "playing" && currentPhase !== "playing") {
      // Each round starts framed on the whole map; zoom choices don't linger.
      mapView.resetView();
    }
    if (state.phase !== currentPhase || !currentScreen) {
      mountScreen(state);
    } else {
      currentScreen.update(state);
    }
    showToast(state);
  };

  // --- Reconnect policy ----------------------------------------------------
  // A dropped link retries against the same room with backoff before giving
  // up and degrading to solo; capacity/admission refusals never retry.
  let socketRoomId: string | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function clearReconnect(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  const handleLinkLost = (info: CloseInfo): void => {
    clearReconnect();
    const fatal = FATAL_CLOSE_CODES.has(info.code);
    const retryable =
      mode === "socket" &&
      socketRoomId !== null &&
      !fatal &&
      reconnectAttempts < RECONNECT_MAX_ATTEMPTS;
    if (!retryable) {
      const detail = info.reason || (info.code > 0 ? `code ${info.code}` : "unreachable");
      client.degradeToSolo(detail);
      mode = "local";
      openLocalRoom();
      return;
    }
    reconnectAttempts += 1;
    client.pauseForReconnect(reconnectAttempts, RECONNECT_MAX_ATTEMPTS);
    reconnectTimer = setTimeout(() => {
      if (socketRoomId !== null) {
        openSocketRoom(socketRoomId);
      }
    }, RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1));
  };

  const handlers: ConnectionHandlers = {
    onMessage: (message) => {
      if (message.t === "welcome") {
        reconnectAttempts = 0;
        clearReconnect();
      }
      client.onMessage(message);
    },
    onClose: (info: CloseInfo) => client.onClose(info),
  };

  const client = new GameClient(
    {
      onState: handleState,
      onVerdict,
      onLinkLost: handleLinkLost,
      onPeerCursor: (playerId, x, y) => {
        const player = lastState?.players.find((candidate) => candidate.id === playerId);
        if (player) {
          mapView.updatePeerCursor(playerId, player.name, player.avatar, x, y);
        }
      },
    },
    identity.name,
    identity.avatar,
  );

  function openSocketRoom(roomId: string): void {
    clearReconnect();
    socketRoomId = roomId;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/room/${encodeURIComponent(roomId)}?player=${encodeURIComponent(identity.userId)}`;
    client.connect(new SocketConnection(url, handlers));
  }

  function openLocalRoom(): void {
    socketRoomId = null;
    client.connect(new LocalConnection(handlers, identity.name));
  }

  function createOnlineGame(): void {
    const code = newRoomCode();
    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    history.replaceState(null, "", url);
    openSocketRoom(`open:${code}`);
  }

  function mountModeChoice(): void {
    bootPanel.replaceChildren();
    const title = el("div", "section-label");
    title.textContent = "How do you want to play?";
    const soloButton = el("button", "btn btn-ghost full");
    soloButton.textContent = "Solo practice";
    soloButton.onclick = () => {
      bootPanel.remove();
      openLocalRoom();
    };
    const onlineButton = el("button", "btn full");
    onlineButton.textContent = "Create online game";
    onlineButton.onclick = () => {
      bootPanel.remove();
      createOnlineGame();
    };

    const joinLabel = el("div", "section-label", "Or join with a code");
    const joinInput = document.createElement("input");
    joinInput.type = "text";
    joinInput.maxLength = 8;
    joinInput.placeholder = "6-character code";
    joinInput.autocomplete = "off";
    joinInput.spellcheck = false;
    const joinButton = el("button", "btn", "Join");
    joinButton.type = "button";
    const attemptJoin = (): void => {
      const code = normalizeJoinCode(joinInput.value);
      if (!code) {
        joinInput.classList.add("invalid");
        joinInput.placeholder = "Looks like ABC234";
        joinInput.value = "";
        return;
      }
      bootPanel.remove();
      const url = new URL(window.location.href);
      url.searchParams.set("room", code);
      history.replaceState(null, "", url);
      openSocketRoom(`open:${code}`);
    };
    joinButton.addEventListener("click", attemptJoin);
    joinInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        attemptJoin();
      }
    });
    joinInput.addEventListener("input", () => joinInput.classList.remove("invalid"));
    const joinField = el("div", "name-field");
    joinField.append(joinInput, joinButton);

    bootPanel.append(title, onlineButton, joinLabel, joinField, soloButton);
  }

  const bootPanel = el("div", "panel boot-panel");
  bootPanel.textContent = "Connecting…";

  mapView.onGuess((featureId) => {
    mapView.pressFeedback(featureId);
    revealRegionName(featureId);
    if (!client.guess(featureId)) {
      // Swallowed locally (already found or already ruled out): acknowledge
      // without scoring so silence never reads as lag.
      mapView.flashMiss(featureId);
    }
  });
  mapView.onLocalCursor((x, y) => client.sendCursor(x, y));

  function revealRegionName(featureId: string): void {
    const name = currentPack?.pack.features.find((feature) => feature.id === featureId)?.name;
    if (!name) {
      return;
    }
    clickLabel.textContent = name;
    clickLabel.classList.add("visible");
    if (nameRevealTimer !== null) {
      clearTimeout(nameRevealTimer);
    }
    nameRevealTimer = setTimeout(() => {
      clickLabel.classList.remove("visible");
      nameRevealTimer = null;
    }, NAME_REVEAL_MS);
  }

  if (identity.instanceId) {
    openSocketRoom(identity.instanceId);
  } else if (joinCode) {
    openSocketRoom(`open:${joinCode}`);
  } else if (identity.embedded) {
    openLocalRoom();
  } else {
    screenHolder.append(bootPanel);
    mountModeChoice();
  }
}

boot().catch((error: unknown) => {
  document.body.textContent = `GeoRumble failed to start: ${String(error)}`;
});
