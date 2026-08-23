import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { CloudflareRoomLimit, type RoomLimitSource } from "./capacity";

/** Singleton name; every worker instance resolves to this one broker DO. */
export const BROKER_SINGLETON = "room-broker";

type AdmitResult = { ok: true } | { ok: false; reason: string };

type RoomRecord = {
  createdAt: number;
  /** Refreshed by GameRoom alarms while occupied; the sweep's liveness signal. */
  lastSeen: number;
};

// Generous on purpose: a room whose alarm keeps firing while occupied is
// refreshed well inside this window, so only genuinely orphaned records
// (e.g. a room that died mid-deploy without releasing) get swept.
const ROOM_TTL_MS = 15 * 60_000;

export class RoomBroker extends DurableObject<Env> {
  private readonly limits: RoomLimitSource;
  private loaded: Promise<Map<string, RoomRecord>> | null = null;

  constructor(ctx: DurableObjectState, env: Env, limits?: RoomLimitSource) {
    super(ctx, env);
    this.limits = limits ?? new CloudflareRoomLimit(env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json<{ roomId?: string }>() : {};
    const roomId = body.roomId ?? "";
    if (!roomId) {
      return Response.json({ error: "missing roomId" }, { status: 400 });
    }

    let result: unknown;
    if (url.pathname === "/admit") {
      result = await this.admit(roomId);
    } else if (url.pathname === "/release") {
      const rooms = await this.registry();
      rooms.delete(roomId);
      await this.persist(rooms);
      result = { ok: true };
    } else if (url.pathname === "/heartbeat") {
      const rooms = await this.registry();
      const record = rooms.get(roomId);
      if (record) {
        record.lastSeen = Date.now();
        await this.persist(rooms);
      }
      result = { ok: true };
    } else {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(result);
  }

  private async admit(roomId: string): Promise<AdmitResult> {
    const rooms = await this.registry();
    const existing = rooms.get(roomId);
    if (existing) {
      // Capacity gates NEW rooms only: joiners of a live room always pass.
      existing.lastSeen = Date.now();
      await this.persist(rooms);
      return { ok: true };
    }

    this.sweep(rooms);
    const limit = await this.limits.limit();
    if (limit !== null && rooms.size >= limit) {
      return { ok: false, reason: "capacity" };
    }
    rooms.set(roomId, { createdAt: Date.now(), lastSeen: Date.now() });
    await this.persist(rooms);
    return { ok: true };
  }

  private sweep(rooms: Map<string, RoomRecord>): void {
    const now = Date.now();
    for (const [roomId, record] of rooms) {
      if (now - record.lastSeen > ROOM_TTL_MS) {
        rooms.delete(roomId);
      }
    }
  }

  private registry(): Promise<Map<string, RoomRecord>> {
    this.loaded ??= this.ctx.storage
      .get<Record<string, RoomRecord>>("rooms")
      .then((stored) => new Map(Object.entries(stored ?? {})));
    return this.loaded;
  }

  private async persist(rooms: Map<string, RoomRecord>): Promise<void> {
    await this.ctx.storage.put("rooms", Object.fromEntries(rooms));
  }
}
