import type { GuessOutcome, RoomSnapshot, ServerMessage } from "../../../shared/protocol";
import type { MapPack } from "../../../shared/mappack";
import type { CloseInfo, Connection } from "../net/connection";
import { randomSeed, seededShuffle } from "./shuffle";

const HINT_AFTER_MISSES = 3;
const TICK_MS = 500;
const NOTICE_MS = 4000;
const MAX_NAME_LENGTH = 32;
const TICKER_SIZE = 4;

export type TickerEntry = {
  byPlayer: string;
  featureId: string;
  correct: boolean;
};

export type ScoreRow = {
  id: string;
  name: string;
  avatar: string | null;
  isYou: boolean;
  correct: number;
  misses: number;
};

export type GameState = {
  phase: "boot" | "lobby" | "playing" | "victory";
  connectionKind: Connection["kind"] | null;
  you: string | null;
  name: string;
  players: { id: string; name: string; avatar: string | null; isHost: boolean; isYou: boolean }[];
  isHost: boolean;
  packId: string | null;
  orderLength: number;
  foundIds: string[];
  target: string | null;
  elapsedSeconds: number;
  correct: number;
  misses: number;
  /** Wrong attempts it took to find each region; drives fill-color tiers. */
  missesByRegion: Record<string, number>;
  /** Who found each found region; drives the finder badge on the map. */
  foundBy: Record<string, string>;
  /** Seats currently voted to return to the lobby; unanimous consent ends the round. */
  lobbyVotes: string[];
  /** Lobby map nominations by player id — feeds the democratic random roll. */
  packVotes: Record<string, string>;
  /** Relay-clock ms when nominations roll into a random choice; null while closed. */
  packVoteDeadline: number | null;
  /** The rolled winner; clients play the reveal, then the host starts it. */
  chosenPackId: string | null;
  /** Relay-clock minus local clock at the last snapshot, for deadline math. */
  clockOffsetMs: number | null;
  hintActive: boolean;
  ticker: TickerEntry[];
  win: { seconds: number; guesses: number } | null;
  scoreboard: ScoreRow[];
  notice: { text: string; kind: "info" | "error" } | null;
};

export type GameEvents = {
  onState: (state: GameState) => void;
  onVerdict: (outcome: GuessOutcome) => void;
  onLinkLost: (info: CloseInfo) => void;
  onPeerCursor: (byPlayer: string, x: number, y: number) => void;
};

type PlayerTally = { correct: number; misses: number };

/**
 * Client-side room brain. Renders ServerMessages into UI state and, while
 * hosting, adjudicates guesses into verdict/advance/win exactly as the
 * relay's host rules expect — over socket or local loopback alike.
 */
export class GameClient {
  private connection: Connection | null = null;
  private snapshot: RoomSnapshot | null = null;
  private you: string | null = null;
  private connected = false;
  private correct = 0;
  private misses = 0;
  private roundGuesses = 0;
  private roundKey: number | null = null;
  private lastOrderIndex: number | null = null;
  private missesByTarget = new Map<string, number>();
  /** Wrong attempts it took to find each region, frozen at the moment of finding. */
  private foundHeat = new Map<string, number>();
  private missedRegions = new Set<string>();
  private foundByRegion: Record<string, string> = {};
  private lobbyVotes: string[] = [];
  private packVotes: Record<string, string> = {};
  private packVoteDeadline: number | null = null;
  private chosenPackId: string | null = null;
  private tallies = new Map<string, PlayerTally>();
  /** Relay-clock minus local-clock at the last snapshot, so elapsed time survives device clock skew. */
  private clockOffset: number | null = null;
  private ticker: TickerEntry[] = [];
  private win: GameState["win"] = null;
  private notice: GameState["notice"] = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(
    private readonly events: GameEvents,
    private name: string,
    private readonly avatar: string | null = null,
  ) {
    this.tickTimer = setInterval(() => this.onTick(), TICK_MS);
  }

  get kind(): Connection["kind"] | null {
    return this.connection?.kind ?? null;
  }

  get playerName(): string {
    return this.name;
  }

  get playerAvatar(): string | null {
    return this.avatar;
  }

  connect(connection: Connection): void {
    this.resetRound();
    this.connection = connection;
    this.connected = true;
    connection.send({ t: "hello", name: this.name, avatar: this.avatar });
    this.emit();
  }

  onMessage = (message: ServerMessage): void => {
    if (this.disposed) {
      return;
    }
    switch (message.t) {
      case "welcome":
        this.you = message.you;
        this.applySnapshot(message.snapshot);
        break;
      case "snapshot":
        this.applySnapshot(message.snapshot);
        break;
      case "host": {
        const previous = this.snapshot?.hostId ?? null;
        if (this.snapshot) {
          this.snapshot = { ...this.snapshot, hostId: message.hostId };
        }
        if (previous !== null && previous !== message.hostId) {
          const name =
            this.snapshot?.players.find((player) => player.id === message.hostId)?.name ??
            "Someone";
          this.setNotice(
            message.hostId === this.you ? "You are now the host" : `${name} is now the host`,
            "info",
          );
        }
        break;
      }
      case "guess":
        this.roundGuesses += 1;
        this.adjudicate(message.byPlayer, message.featureId);
        break;
      case "verdict":
        this.absorbVerdict(message.outcome);
        break;
      case "cursor":
        this.events.onPeerCursor(message.byPlayer, message.x, message.y);
        break;
      case "win":
        this.win = { seconds: message.seconds, guesses: message.guesses };
        if (this.snapshot) {
          this.snapshot = { ...this.snapshot, phase: "victory" };
        }
        break;
      case "rejected":
        this.setNotice(`Rejected: ${message.reason}`, "error");
        break;
      case "pong":
        break;
    }
    this.emit();
  };

  /**
   * Transport failure. State stays mounted so a quick reconnect resumes
   * invisibly; the caller decides between retrying and degrading to solo.
   */
  onClose = (info: CloseInfo): void => {
    if (this.disposed || this.connection === null) {
      return;
    }
    this.connection = null;
    this.connected = false;
    this.events.onLinkLost(info);
    this.emit();
  };

  /** Mid-reconnect limbo: keep the last known room rendered under a notice. */
  pauseForReconnect(attempt: number, max: number): void {
    this.setNotice(`Connection lost — reconnecting (${attempt}/${max})…`, "error");
    this.emit();
  }

  /** Retries exhausted: give up the seat honestly before the solo room opens. */
  degradeToSolo(detail: string): void {
    this.connected = false;
    this.you = null;
    this.setNotice(`Couldn't stay in the room (${detail}) — playing solo`, "info");
    this.emit();
  }

  rename(rawName: string): void {
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
    if (!name || name === this.name) {
      return;
    }
    this.name = name;
    // The avatar rides along because the relay treats hello as the full
    // identity: omitting it would read as "no avatar" and wipe the seat's.
    this.connection?.send({ t: "hello", name, avatar: this.avatar });
    this.emit();
  }

  startGame(pack: MapPack): void {
    if (!this.isHost()) {
      return;
    }
    // Seeded Fisher-Yates; the explicit order travels on the wire so every
    // client derives identical prompts without trusting local RNG mid-round.
    const order = seededShuffle(
      pack.features.map((feature) => feature.id),
      randomSeed(),
    );
    this.send({ t: "start", packId: pack.packId, order });
  }

  /** Host-only: leave victory (or abort the round) and reopen the map picker. */
  backToLobby(): void {
    if (!this.isHost()) {
      return;
    }
    this.send({ t: "lobby" });
  }

  /**
   * Any seat, playing or stuck on the victory screen: toggles this seat's
   * vote to send everyone back to the picker. Solo rooms leave immediately.
   */
  voteLobby(): void {
    const phase = this.snapshot?.phase;
    if (phase !== "playing" && phase !== "victory") {
      return;
    }
    this.send({ t: "vote-lobby" });
  }

  /** Lobby: nominate a map for the democratic random roll (any seat). */
  votePack(packId: string): void {
    if (this.snapshot?.phase !== "lobby") {
      return;
    }
    this.send({ t: "pack-vote", packId });
  }

  /** Nudge the relay once the nomination window expires. */
  resolvePackVotes(): void {
    this.send({ t: "pack-vote-resolve" });
  }

  /** False means the click was swallowed locally and needs its own feedback. */
  guess(featureId: string): boolean {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.phase !== "playing") {
      return false;
    }
    // Repeat-clicking a region already ruled out for this target must not
    // flood the relay or tank accuracy; the caller flashes feedback instead.
    if (snapshot.found.includes(featureId) || this.missedRegions.has(featureId)) {
      return false;
    }
    this.send({ t: "guess", featureId });
    return true;
  }

  sendCursor(x: number, y: number): void {
    this.connection?.send({ t: "cursor", x, y });
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.tickTimer);
    this.clearNotice();
    this.connection?.close();
    this.connection = null;
  }

  private applySnapshot(snapshot: RoomSnapshot): void {
    if (snapshot.startedAt !== this.roundKey) {
      this.resetRound();
      this.roundKey = snapshot.startedAt;
    } else if (snapshot.orderIndex !== this.lastOrderIndex) {
      this.missedRegions.clear();
    }
    this.lastOrderIndex = snapshot.orderIndex;
    // Heat and tallies are relay-owned: adopting them wholesale keeps
    // rejoining clients in sync with everything that happened while away.
    if (snapshot.heat) {
      this.foundHeat = new Map(Object.entries(snapshot.heat));
    }
    if (snapshot.tallies) {
      this.tallies = new Map(Object.entries(snapshot.tallies));
    }
    if (snapshot.foundBy) {
      this.foundByRegion = snapshot.foundBy;
    }
    this.lobbyVotes = snapshot.lobbyVotes ?? [];
    this.packVotes = snapshot.packVotes ?? {};
    this.packVoteDeadline = snapshot.packVoteDeadline ?? null;
    this.chosenPackId = snapshot.chosenPackId ?? null;
    if (typeof snapshot.serverNow === "number") {
      this.clockOffset = snapshot.serverNow - Date.now();
    }
    this.snapshot = snapshot;
  }

  private resetRound(): void {
    this.correct = 0;
    this.misses = 0;
    this.roundGuesses = 0;
    this.lastOrderIndex = null;
    this.missesByTarget.clear();
    this.foundHeat.clear();
    this.missedRegions.clear();
    this.foundByRegion = {};
    this.lobbyVotes = [];
    this.packVotes = {};
    this.packVoteDeadline = null;
    this.chosenPackId = null;
    this.tallies.clear();
    this.ticker = [];
    this.win = null;
    this.roundKey = null;
  }

  /**
   * Host duty: turn a relayed guess into an authoritative verdict. Runs off
   * the echoed broadcast for every guesser, including the host's own clicks.
   */
  private adjudicate(byPlayer: string, featureId: string): void {
    const snapshot = this.snapshot;
    if (!this.isHost() || !snapshot || snapshot.phase !== "playing") {
      return;
    }
    const target = snapshot.target;
    if (!target) {
      return;
    }
    if (snapshot.found.includes(featureId)) {
      // Fast-finger race: the region was solved between this click and its
      // echo. Acknowledge green without touching anyone's score — the relay
      // dedupes found[] and every client treats repeat-corrects as flash-only.
      this.send({
        t: "verdict",
        outcome: {
          featureId,
          byPlayer,
          correct: true,
          remaining: Math.max(0, snapshot.order.length - snapshot.found.length),
        },
      });
      return;
    }
    const correct = featureId === target;
    this.send({
      t: "verdict",
      outcome: {
        featureId,
        byPlayer,
        correct,
        remaining: Math.max(0, snapshot.order.length - snapshot.found.length - (correct ? 1 : 0)),
      },
    });
  }

  private absorbVerdict(outcome: GuessOutcome): void {
    const snapshot = this.snapshot;
    const alreadyFound = snapshot?.found.includes(outcome.featureId) ?? false;
    if (alreadyFound) {
      if (outcome.correct) {
        // Duplicate ruling from racing clicks: score stays with the first
        // finder, but the late clicker still gets their green flash.
        this.events.onVerdict(outcome);
      }
      return;
    }

    const tally = this.tallies.get(outcome.byPlayer) ?? { correct: 0, misses: 0 };
    if (outcome.correct) {
      this.correct += 1;
      tally.correct += 1;
      const target = snapshot?.target ?? outcome.featureId;
      this.foundHeat.set(outcome.featureId, this.missesByTarget.get(target) ?? 0);
      this.foundByRegion = { ...this.foundByRegion, [outcome.featureId]: outcome.byPlayer };
      if (snapshot) {
        this.snapshot = { ...snapshot, found: [...snapshot.found, outcome.featureId] };
      }
    } else {
      this.misses += 1;
      tally.misses += 1;
      this.missedRegions.add(outcome.featureId);
      const target = snapshot?.target ?? null;
      if (target !== null) {
        this.missesByTarget.set(target, (this.missesByTarget.get(target) ?? 0) + 1);
      }
    }
    this.tallies.set(outcome.byPlayer, tally);

    this.ticker = [
      { byPlayer: outcome.byPlayer, featureId: outcome.featureId, correct: outcome.correct },
      ...this.ticker,
    ].slice(0, TICKER_SIZE);
    this.events.onVerdict(outcome);

    const next = this.snapshot;
    if (this.isHost() && next && next.phase === "playing" && outcome.correct) {
      if (next.found.length >= next.order.length) {
        this.send({
          t: "win",
          seconds: this.elapsedSeconds(),
          guesses: Math.max(1, this.roundGuesses),
        });
      } else {
        this.send({ t: "advance", index: (next.orderIndex ?? -1) + 1 });
      }
    }
  }

  private isHost(): boolean {
    return this.you !== null && this.snapshot?.hostId === this.you;
  }

  private elapsedSeconds(): number {
    const startedAt = this.snapshot?.startedAt;
    if (startedAt === null || startedAt === undefined) {
      return 0;
    }
    const now = Date.now() + (this.clockOffset ?? 0);
    return Math.max(0, Math.round((now - startedAt) / 1000));
  }

  private onTick(): void {
    if (this.snapshot?.phase === "playing") {
      this.emit();
    }
  }

  private setNotice(text: string, kind: "info" | "error"): void {
    this.notice = { text, kind };
    this.clearNotice();
    this.noticeTimer = setTimeout(() => {
      this.notice = null;
      this.emit();
    }, NOTICE_MS);
  }

  private clearNotice(): void {
    if (this.noticeTimer !== null) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
  }

  private send(message: Parameters<Connection["send"]>[0]): void {
    this.connection?.send(message);
  }

  private emit(): void {
    if (this.disposed) {
      return;
    }
    const snapshot = this.snapshot;
    const target = snapshot?.target ?? null;
    this.events.onState({
      phase: snapshot?.phase ?? "boot",
      connectionKind: this.connection?.kind ?? null,
      you: this.you,
      name: this.name,
      players: (snapshot?.players ?? []).map((player) => ({
        id: player.id,
        name: player.name,
        avatar: player.avatar ?? null,
        isHost: player.id === snapshot?.hostId,
        isYou: player.id === this.you,
      })),
      isHost: this.isHost(),
      packId: snapshot?.packId ?? null,
      orderLength: snapshot?.order.length ?? 0,
      foundIds: snapshot?.found ?? [],
      target,
      elapsedSeconds: this.elapsedSeconds(),
      correct: this.correct,
      misses: this.misses,
      missesByRegion: Object.fromEntries(this.foundHeat),
      foundBy: this.foundByRegion,
      lobbyVotes: this.lobbyVotes,
      packVotes: this.packVotes,
      packVoteDeadline: this.packVoteDeadline,
      chosenPackId: this.chosenPackId,
      clockOffsetMs: this.clockOffset,
      hintActive:
        target !== null && (this.missesByTarget.get(target) ?? 0) >= HINT_AFTER_MISSES,
      ticker: this.ticker,
      win: this.win,
      scoreboard: (snapshot?.players ?? []).map((player) => {
        const tally = this.tallies.get(player.id) ?? { correct: 0, misses: 0 };
        return {
          id: player.id,
          name: player.name,
          avatar: player.avatar ?? null,
          isYou: player.id === this.you,
          correct: tally.correct,
          misses: tally.misses,
        };
      }),
      notice: this.notice,
    });
  }
}
