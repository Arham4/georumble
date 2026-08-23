import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import {
  CLOSE_HELLO_TIMEOUT,
  CLOSE_ROOM_FULL,
  type ClientMessage,
  type GuessOutcome,
  type Phase,
  type RoomSnapshot,
  type ServerMessage,
} from "../../shared/protocol";
import { BROKER_SINGLETON } from "./broker";
import { rejectUpgrade } from "./upgrade";

// Matches the design-patterns guidance that voice channels are the real ceiling.
const MAX_PARTICIPANTS = 30;
const MAX_NAME_LENGTH = 32;
const MAX_AVATAR_LENGTH = 64;
const HELLO_TIMEOUT_MS = 30_000;
const ALARM_INTERVAL_MS = 5 * 60_000;
const CURSOR_MIN_INTERVAL_MS = 33;

type StoredPlayer = {
  id: string;
  name: string;
  avatar?: string | null;
  joinedAt: number;
};

/**
 * Everything needed to render a room after eviction. Membership and progress
 * only: correctness of guesses stays on the hosting client, so this stays
 * relay state rather than game rules.
 */
type PersistedRoom = {
  players: StoredPlayer[];
  hostId: string | null;
  /** Most recent handoff donor, so a refresh can reclaim an idle crown. */
  lastHostId: string | null;
  /** Host that started the current round, so a mid-round refresh can reclaim. */
  roundHostId: string | null;
  phase: Phase;
  packId: string | null;
  order: string[];
  orderIndex: number | null;
  found: string[];
  startedAt: number | null;
};

type SocketAttachment = { playerId: string };

export class GameRoom extends DurableObject<Env> {
  private readonly roomId: string;
  private room: PersistedRoom | null = null;
  private sockets = new Map<string, WebSocket>();
  private pending = new Map<WebSocket, number>();
  private lastCursorAt = new Map<string, number>();
  private ready: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.roomId = ctx.id.name ?? ctx.id.toString();
    // Answered by the runtime while hibernating, so keepalives never wake us.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ t: "ping" } satisfies ClientMessage),
        JSON.stringify({ t: "pong" } satisfies ServerMessage),
      ),
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "websocket required" }, { status: 426 });
    }
    await this.ensureReady();
    if (this.room === null) {
      this.room = {
        players: [],
        hostId: null,
        lastHostId: null,
        roundHostId: null,
        phase: "lobby",
        packId: null,
        order: [],
        orderIndex: null,
        found: [],
        startedAt: null,
      };
      await this.persist();
    }

    const url = new URL(request.url);
    const playerId = url.searchParams.get("player") || crypto.randomUUID();
    const returning = this.room?.players.some((p) => p.id === playerId) ?? false;
    if (!returning && this.room !== null && this.room.players.length >= MAX_PARTICIPANTS) {
      return rejectUpgrade("room-full", CLOSE_ROOM_FULL);
    }

    const pair = new WebSocketPair();
    const server = pair[1];
    server.serializeAttachment({ playerId } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, [`player:${playerId}`, `room:${this.roomId}`]);
    this.pending.set(server, Date.now());
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.ensureReady();
    if (typeof raw !== "string") {
      this.sendTo(ws, { t: "rejected", reason: "binary unsupported" });
      return;
    }
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.sendTo(ws, { t: "rejected", reason: "malformed json" });
      return;
    }
    if (typeof message?.t !== "string") {
      this.sendTo(ws, { t: "rejected", reason: "malformed message" });
      return;
    }

    const playerId = this.attachedPlayer(ws);
    if (playerId === null) {
      this.sendTo(ws, { t: "rejected", reason: "unidentified socket" });
      return;
    }
    if (message.t === "hello") {
      await this.join(ws, playerId, message.name, message.avatar);
      return;
    }
    if (!this.room?.players.some((p) => p.id === playerId)) {
      this.sendTo(ws, { t: "rejected", reason: "hello required" });
      return;
    }

    switch (message.t) {
      case "guess":
        if (typeof message.featureId !== "string" || !message.featureId || message.featureId.length > 64) {
          this.sendTo(ws, { t: "rejected", reason: "invalid guess" });
          break;
        }
        this.broadcast({ t: "guess", featureId: message.featureId, byPlayer: playerId });
        break;
      case "cursor":
        this.relayCursor(ws, playerId, message.x, message.y);
        break;
      case "start":
        await this.start(playerId, message.packId, message.order);
        break;
      case "verdict":
        await this.verdict(playerId, message.outcome);
        break;
      case "advance":
        await this.advance(playerId, message.index);
        break;
      case "win":
        await this.win(playerId, message.seconds, message.guesses);
        break;
      default:
        this.sendTo(ws, { t: "rejected", reason: "unknown message" });
    }
  }

  /** Live pointer positions are pure relay traffic: no storage, sender excluded. */
  private relayCursor(sender: WebSocket, playerId: string, x: unknown, y: unknown): void {
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    const now = Date.now();
    if (now - (this.lastCursorAt.get(playerId) ?? 0) < CURSOR_MIN_INTERVAL_MS) {
      return;
    }
    this.lastCursorAt.set(playerId, now);
    const encoded = JSON.stringify({
      t: "cursor",
      byPlayer: playerId,
      x,
      y,
    } satisfies ServerMessage);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== sender && ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(encoded);
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ensureReady();
    const playerId = this.attachedPlayer(ws);
    this.pending.delete(ws);
    if (!playerId || this.sockets.get(playerId) !== ws) {
      // A reconnect already took the player's seat; this is just the stale twin.
      return;
    }
    this.sockets.delete(playerId);
    if (!this.room) {
      return;
    }
    this.room.players = this.room.players.filter((p) => p.id !== playerId);
    if (this.room.players.length === 0) {
      await this.teardown();
      return;
    }
    if (this.room.hostId === playerId) {
      this.room.lastHostId = playerId;
      this.room.hostId = this.room.players[0].id;
      this.broadcast({ t: "host", hostId: this.room.hostId });
    }
    await this.persist();
    this.broadcast({ t: "snapshot", snapshot: this.snapshot(this.room) });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const [ws, joinedAt] of this.pending) {
      if (now - joinedAt > HELLO_TIMEOUT_MS) {
        this.pending.delete(ws);
        ws.close(CLOSE_HELLO_TIMEOUT, "hello-timeout");
      }
    }
    if (this.ctx.getWebSockets().length === 0 || this.isEmpty()) {
      await this.teardown();
      return;
    }
    await this.heartbeatBroker();
    await this.scheduleAlarm();
  }

  private async join(ws: WebSocket, playerId: string, rawName: string, rawAvatar: unknown): Promise<void> {
    const room = this.room;
    if (!room) {
      return;
    }
    this.pending.delete(ws);
    const name = (rawName || "").trim().slice(0, MAX_NAME_LENGTH) || "Player";
    const avatar = typeof rawAvatar === "string" && rawAvatar.length > 0 && rawAvatar.length <= MAX_AVATAR_LENGTH
      ? rawAvatar.replace(/[^A-Za-z0-9_-]/g, "")
      : null;
    let player = room.players.find((p) => p.id === playerId);
    if (!player) {
      player = { id: playerId, name, joinedAt: Date.now() };
      room.players.push(player);
    } else {
      player.name = name;
    }
    player.avatar = avatar;
    this.sockets.set(playerId, ws);

    const electedHost = room.hostId === null;
    // A page refresh can close the old socket before the new hello arrives,
    // which hands the crown away; the refresher takes it back so Start never
    // wanders away from the room's owner.
    const reclaimable =
      !electedHost && room.hostId !== playerId &&
      (room.phase === "lobby" ? room.lastHostId === playerId : room.roundHostId === playerId);
    if (electedHost || reclaimable) {
      room.hostId = playerId;
    }
    await this.persist();
    this.sendTo(ws, { t: "welcome", you: playerId, snapshot: this.snapshot(room) });
    if (electedHost || reclaimable) {
      this.broadcast({ t: "host", hostId: playerId });
    }
    this.broadcast({ t: "snapshot", snapshot: this.snapshot(room) });
  }

  private async start(hostId: string, packId: unknown, order: unknown): Promise<void> {
    if (!this.requireHost(hostId)) {
      return;
    }
    if (
      typeof packId !== "string" ||
      !packId ||
      !Array.isArray(order) ||
      order.length === 0 ||
      order.some((id) => typeof id !== "string" || !id)
    ) {
      this.denyHost(hostId, "invalid start");
      return;
    }
    const sequence = order as string[];
    if (new Set(sequence).size !== sequence.length) {
      this.denyHost(hostId, "duplicate order entries");
      return;
    }
    const room = this.room;
    if (!room) {
      return;
    }
    room.phase = "playing";
    room.packId = packId;
    room.order = sequence;
    room.orderIndex = 0;
    room.found = [];
    room.startedAt = Date.now();
    room.roundHostId = hostId;
    await this.persist();
    this.broadcast({ t: "snapshot", snapshot: this.snapshot(room) });
  }

  private async verdict(hostId: string, outcome: unknown): Promise<void> {
    if (!this.requireHost(hostId)) {
      return;
    }
    const parsed = outcome as Partial<GuessOutcome> | null;
    if (
      !parsed ||
      typeof parsed.featureId !== "string" ||
      typeof parsed.byPlayer !== "string" ||
      typeof parsed.correct !== "boolean"
    ) {
      this.denyHost(hostId, "invalid verdict");
      return;
    }
    const room = this.room;
    if (!room) {
      return;
    }
    if (!room.players.some((p) => p.id === parsed.byPlayer)) {
      this.denyHost(hostId, "unknown player");
      return;
    }
    if (parsed.correct && !room.found.includes(parsed.featureId)) {
      room.found.push(parsed.featureId);
    }
    const verified: GuessOutcome = {
      featureId: parsed.featureId,
      byPlayer: parsed.byPlayer,
      correct: parsed.correct,
      remaining: Math.max(0, room.order.length - room.found.length),
    };
    await this.persist();
    this.broadcast({ t: "verdict", outcome: verified });
  }

  private async advance(hostId: string, index: unknown): Promise<void> {
    if (!this.requireHost(hostId)) {
      return;
    }
    const room = this.room;
    if (!room) {
      return;
    }
    const current = room.orderIndex ?? -1;
    if (typeof index !== "number" || !Number.isInteger(index)) {
      this.denyHost(hostId, "invalid advance");
      return;
    }
    if (index <= current) {
      // Racing verdicts can advance twice from a stale index; a redundant
      // advance is benign, so absorb it silently instead of toasting an error.
      return;
    }
    if (index >= room.order.length) {
      this.denyHost(hostId, "invalid advance");
      return;
    }
    room.orderIndex = index;
    await this.persist();
    this.broadcast({ t: "snapshot", snapshot: this.snapshot(room) });
  }

  private async win(hostId: string, seconds: unknown, guesses: unknown): Promise<void> {
    if (!this.requireHost(hostId)) {
      return;
    }
    const room = this.room;
    if (!room) {
      return;
    }
    if (room.phase !== "playing" || room.found.length < room.order.length) {
      this.denyHost(hostId, "win not earned");
      return;
    }
    if (typeof seconds !== "number" || typeof guesses !== "number") {
      this.denyHost(hostId, "invalid win");
      return;
    }
    // The relay owns the clock: startedAt was stamped here, so finish time is
    // restamped rather than trusted from the hosting client.
    const stampedSeconds =
      room.startedAt !== null ? Math.round((Date.now() - room.startedAt) / 1000) : seconds;
    room.phase = "victory";
    await this.persist();
    this.broadcast({ t: "win", seconds: stampedSeconds, guesses });
  }

  private requireHost(senderId: string): boolean {
    if (this.room?.hostId === senderId) {
      return true;
    }
    this.denyHost(senderId, "not-host");
    return false;
  }

  private denyHost(playerId: string, reason: string): void {
    const ws = this.sockets.get(playerId);
    if (ws) {
      this.sendTo(ws, { t: "rejected", reason });
    }
  }

  private async ensureReady(): Promise<void> {
    this.ready ??= (async () => {
      this.room = (await this.ctx.storage.get<PersistedRoom>("room")) ?? null;
      for (const ws of this.ctx.getWebSockets()) {
        const attached = ws.deserializeAttachment() as SocketAttachment | null;
        if (attached && typeof attached.playerId === "string") {
          this.sockets.set(attached.playerId, ws);
        }
      }
    })();
    return this.ready;
  }

  private isEmpty(): boolean {
    return this.room === null || this.room.players.length === 0;
  }

  private snapshot(room: PersistedRoom): RoomSnapshot {
    return {
      hostId: room.hostId,
      players: room.players.map(({ id, name, avatar }) => ({
        id,
        name,
        ...(avatar ? { avatar } : {}),
      })),
      phase: room.phase,
      packId: room.packId,
      order: room.order,
      orderIndex: room.orderIndex,
      found: room.found,
      target:
        room.orderIndex !== null ? (room.order[room.orderIndex] ?? null) : null,
      startedAt: room.startedAt,
    };
  }

  private attachedPlayer(ws: WebSocket): string | null {
    if (ws.deserializeAttachment) {
      const attached = ws.deserializeAttachment() as SocketAttachment | null;
      if (attached) {
        return attached.playerId;
      }
    }
    const tag = this.ctx.getTags(ws).find((t) => t.startsWith("player:"));
    return tag ? tag.slice("player:".length) : null;
  }

  private sendTo(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.READY_STATE_OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(message: ServerMessage): void {
    const encoded = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(encoded);
      }
    }
  }

  private async scheduleAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put("room", this.room);
  }

  private async teardown(): Promise<void> {
    for (const ws of this.pending.keys()) {
      ws.close(CLOSE_HELLO_TIMEOUT, "room-closed");
    }
    this.pending.clear();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    this.room = null;
    this.ready = null;
    await this.releaseWithBroker();
  }

  private async heartbeatBroker(): Promise<void> {
    await this.brokerCall("heartbeat").catch(() => undefined);
  }

  private async releaseWithBroker(): Promise<void> {
    await this.brokerCall("release").catch(() => undefined);
  }

  private brokerCall(action: "heartbeat" | "release"): Promise<Response> {
    const broker = this.env.BROKER.get(this.env.BROKER.idFromName(BROKER_SINGLETON));
    return broker.fetch(`https://broker/${action}`, {
      method: "POST",
      body: JSON.stringify({ roomId: this.roomId }),
    });
  }
}
