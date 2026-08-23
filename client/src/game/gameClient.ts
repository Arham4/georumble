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

export type GameState = {
  phase: "boot" | "lobby" | "playing" | "victory";
  connectionKind: Connection["kind"] | null;
  you: string | null;
  name: string;
  players: { id: string; name: string; isHost: boolean; isYou: boolean }[];
  isHost: boolean;
  packId: string | null;
  orderLength: number;
  foundIds: string[];
  target: string | null;
  elapsedSeconds: number;
  correct: number;
  misses: number;
  hintActive: boolean;
  ticker: TickerEntry[];
  win: { seconds: number; guesses: number } | null;
  notice: { text: string; kind: "info" | "error" } | null;
};

export type GameEvents = {
  onState: (state: GameState) => void;
  onVerdict: (outcome: GuessOutcome) => void;
  onNeedFallback: () => void;
};

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
  private missesByTarget = new Map<string, number>();
  private ticker: TickerEntry[] = [];
  private win: GameState["win"] = null;
  private notice: GameState["notice"] = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly events: GameEvents,
    private name: string,
  ) {
    setInterval(() => this.onTick(), TICK_MS);
  }

  get kind(): Connection["kind"] | null {
    return this.connection?.kind ?? null;
  }

  get playerName(): string {
    return this.name;
  }

  connect(connection: Connection): void {
    this.resetRound();
    this.connection = connection;
    this.connected = true;
    connection.send({ t: "hello", name: this.name });
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
      case "host":
        if (this.snapshot) {
          this.snapshot = { ...this.snapshot, hostId: message.hostId };
        }
        break;
      case "guess":
        this.roundGuesses += 1;
        this.adjudicate(message.byPlayer, message.featureId);
        break;
      case "verdict":
        this.absorbVerdict(message.outcome);
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

  onClose = (info: CloseInfo): void => {
    if (this.disposed || this.connection === null) {
      return;
    }
    this.connection = null;
    this.connected = false;
    this.you = null;
    const detail = info.reason || (info.code > 0 ? `code ${info.code}` : "unreachable");
    this.setNotice(`Live room lost (${detail}) — continuing in a solo room`, "info");
    this.events.onNeedFallback();
    this.emit();
  };

  rename(rawName: string): void {
    const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
    if (!name || name === this.name) {
      return;
    }
    this.name = name;
    this.connection?.send({ t: "hello", name });
    this.emit();
  }

  startGame(pack: MapPack): void {
    if (!this.isHost()) {
      return;
    }
    // Seeded Fisher-Yates keeps the shuffle reproducible from its seed while
    // every client receives the same explicit order on the wire.
    const order = seededShuffle(
      pack.features.map((feature) => feature.id),
      randomSeed(),
    );
    this.send({ t: "start", packId: pack.packId, order });
  }

  guess(featureId: string): void {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.phase !== "playing" || snapshot.found.includes(featureId)) {
      return;
    }
    this.send({ t: "guess", featureId });
  }

  dispose(): void {
    this.disposed = true;
    this.clearNotice();
    this.connection?.close();
    this.connection = null;
  }

  private applySnapshot(snapshot: RoomSnapshot): void {
    if (snapshot.startedAt !== this.roundKey) {
      this.resetRound();
      this.roundKey = snapshot.startedAt;
    }
    this.snapshot = snapshot;
  }

  private resetRound(): void {
    this.correct = 0;
    this.misses = 0;
    this.roundGuesses = 0;
    this.missesByTarget.clear();
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
    if (!target || snapshot.found.includes(featureId)) {
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
    if (outcome.correct) {
      this.correct += 1;
    } else {
      this.misses += 1;
    }
    const target = this.snapshot?.target ?? null;
    if (!outcome.correct && target !== null) {
      this.missesByTarget.set(target, (this.missesByTarget.get(target) ?? 0) + 1);
    }
    this.ticker = [
      { byPlayer: outcome.byPlayer, featureId: outcome.featureId, correct: outcome.correct },
      ...this.ticker,
    ].slice(0, TICKER_SIZE);
    this.events.onVerdict(outcome);

    const snapshot = this.snapshot;
    if (this.isHost() && snapshot && snapshot.phase === "playing" && outcome.correct) {
      if (outcome.remaining === 0) {
        this.send({
          t: "win",
          seconds: this.elapsedSeconds(),
          guesses: Math.max(1, this.roundGuesses),
        });
      } else {
        this.send({ t: "advance", index: (snapshot.orderIndex ?? -1) + 1 });
      }
    }
  }

  private isHost(): boolean {
    return this.you !== null && this.snapshot?.hostId === this.you;
  }

  private elapsedSeconds(): number {
    const startedAt = this.snapshot?.startedAt;
    return startedAt === null || startedAt === undefined
      ? 0
      : Math.max(0, Math.round((Date.now() - startedAt) / 1000));
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
      hintActive:
        target !== null && (this.missesByTarget.get(target) ?? 0) >= HINT_AFTER_MISSES,
      ticker: this.ticker,
      win: this.win,
      notice: this.notice,
    });
  }
}
