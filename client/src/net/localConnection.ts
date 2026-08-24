import type {
  ClientMessage,
  GuessOutcome,
  Phase,
  Player,
  RoomSnapshot,
  ServerMessage,
} from "../../../shared/protocol";
import { dispatchMessage, type Connection, type ConnectionHandlers } from "./connection";

type LocalRoom = {
  players: Player[];
  hostId: string | null;
  phase: Phase;
  packId: string | null;
  order: string[];
  orderIndex: number | null;
  found: string[];
  heat: Record<string, number>;
  tallies: Record<string, { correct: number; misses: number }>;
  startedAt: number | null;
};

function emptyRoom(): LocalRoom {
  return { players: [], hostId: null, phase: "lobby", packId: null, order: [], orderIndex: null, found: [], heat: {}, tallies: {}, startedAt: null };
}

/**
 * In-browser loopback that speaks the relay's exact message contract, so the
 * same game code runs solo (capacity-rejected, no Discord context, WS
 * failure) without a server. The single local player is always the host.
 */
export class LocalConnection implements Connection {
  readonly kind = "local" as const;

  private readonly handlers: ConnectionHandlers;
  private readonly playerId: string;
  private room: LocalRoom | null = emptyRoom();
  private outbox: ServerMessage[] = [];
  private closed = false;

  constructor(handlers: ConnectionHandlers, name: string) {
    this.handlers = handlers;
    this.playerId = crypto.randomUUID();
    this.join(name.trim().slice(0, 32) || "Player");
  }

  send(message: ClientMessage): void {
    if (this.closed) {
      return;
    }
    switch (message.t) {
      case "hello":
        this.rename(message.name);
        break;
      case "ping":
        this.enqueue({ t: "pong" });
        break;
      case "start":
        this.start(message.packId, message.order);
        break;
      case "guess":
        if (this.hasJoined()) {
          this.enqueue({ t: "guess", featureId: message.featureId, byPlayer: this.playerId });
        }
        break;
      // Solo play has nobody to show a pointer to.
      case "cursor":
        break;
      case "verdict":
        this.verdict(message.outcome);
        break;
      case "advance":
        this.advance(message.index);
        break;
      case "win":
        this.win(message.seconds, message.guesses);
        break;
      case "lobby":
        this.backToLobby();
        break;
    }
  }

  close(): void {
    this.closed = true;
    this.outbox = [];
    this.room = null;
  }

  private join(name: string): void {
    const room = this.room!;
    const player: Player = { id: this.playerId, name };
    room.players.push(player);
    room.hostId = player.id;
    this.enqueue({ t: "welcome", you: this.playerId, snapshot: this.snapshot() });
    this.enqueue({ t: "host", hostId: room.hostId });
    this.enqueue({ t: "snapshot", snapshot: this.snapshot() });
  }

  private rename(rawName: string): void {
    const player = this.room?.players.find((p) => p.id === this.playerId);
    if (!player) {
      return;
    }
    player.name = rawName.trim().slice(0, 32) || "Player";
    this.enqueue({ t: "snapshot", snapshot: this.snapshot() });
  }

  private start(packId: unknown, order: unknown): void {
    if (!this.requireHost()) {
      return;
    }
    if (
      typeof packId !== "string" ||
      !packId ||
      !Array.isArray(order) ||
      order.length === 0 ||
      order.some((id) => typeof id !== "string" || !id)
    ) {
      this.reject("invalid start");
      return;
    }
    const sequence = order as string[];
    if (new Set(sequence).size !== sequence.length) {
      this.reject("duplicate order entries");
      return;
    }
    const room = this.room!;
    room.phase = "playing";
    room.packId = packId;
    room.order = sequence;
    room.orderIndex = 0;
    room.found = [];
    room.heat = {};
    room.tallies = {};
    room.startedAt = Date.now();
    this.enqueue({ t: "snapshot", snapshot: this.snapshot() });
  }

  private verdict(outcome: GuessOutcome): void {
    if (!this.requireHost()) {
      return;
    }
    const room = this.room!;
    if (!room.players.some((p) => p.id === outcome.byPlayer)) {
      this.reject("unknown player");
      return;
    }
    const tally = room.tallies[outcome.byPlayer] ?? { correct: 0, misses: 0 };
    if (outcome.correct) {
      if (!room.found.includes(outcome.featureId)) {
        room.found.push(outcome.featureId);
        tally.correct += 1;
      }
    } else {
      tally.misses += 1;
      const target = room.orderIndex !== null ? room.order[room.orderIndex] : null;
      if (target !== null) {
        room.heat[target] = (room.heat[target] ?? 0) + 1;
      }
    }
    room.tallies[outcome.byPlayer] = tally;
    const verified: GuessOutcome = {
      featureId: outcome.featureId,
      byPlayer: outcome.byPlayer,
      correct: outcome.correct,
      remaining: Math.max(0, room.order.length - room.found.length),
    };
    this.enqueue({ t: "verdict", outcome: verified });
  }

  private advance(index: number): void {
    if (!this.requireHost()) {
      return;
    }
    const room = this.room!;
    const current = room.orderIndex ?? -1;
    if (typeof index !== "number" || !Number.isInteger(index)) {
      this.reject("invalid advance");
      return;
    }
    if (index <= current) {
      return;
    }
    if (index >= room.order.length) {
      this.reject("invalid advance");
      return;
    }
    room.orderIndex = index;
    this.enqueue({ t: "snapshot", snapshot: this.snapshot() });
  }

  private win(seconds: number, guesses: number): void {
    if (!this.requireHost()) {
      return;
    }
    const room = this.room!;
    if (typeof seconds !== "number" || typeof guesses !== "number") {
      this.reject("invalid win");
      return;
    }
    if (room.phase !== "playing" || room.startedAt === null || room.found.length < room.order.length) {
      this.reject("win not earned");
      return;
    }
    // Mirror the relay: the clock owner restamps finish time rather than
    // trusting the hosting client.
    const stampedSeconds = Math.round((Date.now() - room.startedAt) / 1000);
    room.phase = "victory";
    this.enqueue({ t: "win", seconds: stampedSeconds, guesses });
  }

  /** Mirrors the relay: clear the round and reopen the map picker. */
  private backToLobby(): void {
    if (!this.requireHost()) {
      return;
    }
    const room = this.room!;
    if (room.phase === "lobby") {
      return;
    }
    room.phase = "lobby";
    room.orderIndex = null;
    room.found = [];
    room.heat = {};
    room.tallies = {};
    room.startedAt = null;
    this.enqueue({ t: "snapshot", snapshot: this.snapshot() });
  }

  private requireHost(): boolean {
    return this.room?.hostId === this.playerId;
  }

  private hasJoined(): boolean {
    return this.room?.players.some((p) => p.id === this.playerId) ?? false;
  }

  private reject(reason: string): void {
    this.enqueue({ t: "rejected", reason });
  }

  private snapshot(): RoomSnapshot {
    const room = this.room!;
    return {
      hostId: room.hostId,
      players: room.players.map(({ id, name }) => ({ id, name })),
      phase: room.phase,
      packId: room.packId,
      order: [...room.order],
      orderIndex: room.orderIndex,
      found: [...room.found],
      heat: { ...room.heat },
      tallies: Object.fromEntries(Object.entries(room.tallies).map(([id, t]) => [id, { ...t }])),
      target: room.orderIndex !== null ? (room.order[room.orderIndex] ?? null) : null,
      startedAt: room.startedAt,
    };
  }

  private enqueue(message: ServerMessage): void {
    if (this.closed) {
      return;
    }
    this.outbox.push(message);
    queueMicrotask(() => this.drain());
  }

  private drain(): void {
    if (this.closed) {
      return;
    }
    for (const message of this.outbox.splice(0)) {
      dispatchMessage(this.handlers, JSON.stringify(message));
    }
  }
}
