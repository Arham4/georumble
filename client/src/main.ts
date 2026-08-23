import "./theme.css";
import type { GuessOutcome } from "../../shared/protocol";
import { GameClient, type GameState } from "./game/gameClient";
import { PackStore, type LoadedPack } from "./game/packs";
import { MapView } from "./map/mapView";
import type { ConnectionHandlers } from "./net/connection";
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

type Identity = {
  userId: string;
  name: string;
  instanceId: string | null;
};

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null | undefined;
};

type AuthenticateShape = {
  user: DiscordUser;
};

function guestIdentity(): Identity {
  let userId = localStorage.getItem(ID_STORAGE_KEY);
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem(ID_STORAGE_KEY, userId);
  }
  return {
    userId,
    name: localStorage.getItem(NAME_STORAGE_KEY) ?? "",
    instanceId: null,
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
      instanceId: sdk.instanceId,
    };
  } catch {
    return fallback;
  }
}

async function boot(): Promise<void> {
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
  // Discord instances own the room decision outright; browser sessions may opt
  // into an online room only via a well-formed code in the URL.
  const joinCode = identity.instanceId ? null : normalizeJoinCode(new URLSearchParams(window.location.search).get("room"));
  const startOnline = identity.instanceId !== null || joinCode !== null;
  let mode: "socket" | "local" = startOnline ? "socket" : "local";

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
        currentScreen = createLobbyScreen(screenHolder, { client, store });
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
        hintActive: false,
        ticker: [],
        win: null,
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
    mapView.setFound(state.foundIds);
    mapView.setTarget(state.target);
    mapView.setHint(state.hintActive);
    mapView.setInteractive(state.phase === "playing");
    if (state.phase !== currentPhase || !currentScreen) {
      mountScreen(state);
    } else {
      currentScreen.update(state);
    }
    showToast(state);
  };

  const handlers: ConnectionHandlers = {
    onMessage: (message) => client.onMessage(message),
    onClose: (info) => client.onClose(info),
  };

  const client = new GameClient(
    {
      onState: handleState,
      onVerdict,
      onNeedFallback: () => {
        if (mode !== "local") {
          mode = "local";
          openLocalRoom();
        }
      },
    },
    identity.name,
  );

  function openSocketRoom(roomId: string): void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/room/${encodeURIComponent(roomId)}?player=${encodeURIComponent(identity.userId)}`;
    client.connect(new SocketConnection(url, handlers));
  }

  function openLocalRoom(): void {
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
    bootPanel.append(title, onlineButton, soloButton);
  }

  const bootPanel = el("div", "panel boot-panel");
  bootPanel.textContent = "Connecting…";

  mapView.onGuess((featureId) => client.guess(featureId));
  if (identity.instanceId) {
    openSocketRoom(identity.instanceId);
  } else if (joinCode) {
    openSocketRoom(`open:${joinCode}`);
  } else {
    screenHolder.append(bootPanel);
    mountModeChoice();
  }
}

boot().catch((error: unknown) => {
  document.body.textContent = `GeoRumble failed to start: ${String(error)}`;
});
