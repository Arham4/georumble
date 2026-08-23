import { BROKER_SINGLETON } from "./broker";
import { CLOSE_CAPACITY } from "../../shared/protocol";
import { exchangeCode } from "./token";
import { rejectUpgrade } from "./upgrade";
import type { Env } from "./env";

export { GameRoom } from "./room";
export { RoomBroker } from "./broker";

const ROOM_ROUTE = /^\/api\/room\/([^/]+)$/;

type AdmitReply = { ok?: boolean; reason?: string };

type AdmitResult = { ok: true } | { ok: false; reason: string };

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/token") {
      return exchangeCode(request, env);
    }
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    const roomMatch = ROOM_ROUTE.exec(url.pathname);
    if (roomMatch) {
      return enterRoom(decodeURIComponent(roomMatch[1]), request, env);
    }
    return env.AppAssets.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function enterRoom(roomId: string, request: Request, env: Env): Promise<Response> {
  const admitted = await admit(roomId, env);
  if (!admitted.ok) {
    return rejectUpgrade(admitted.reason, CLOSE_CAPACITY);
  }
  return env.ROOM.get(env.ROOM.idFromName(roomId)).fetch(request);
}

async function admit(roomId: string, env: Env): Promise<AdmitResult> {
  const broker = env.BROKER.get(env.BROKER.idFromName(BROKER_SINGLETON));
  const reply = await broker
    .fetch("https://broker/admit", {
      method: "POST",
      body: JSON.stringify({ roomId }),
    })
    .then((response) => response.json<AdmitReply>())
    // A broker outage must not take live games down; the gate is advisory.
    .catch(() => ({}) as AdmitReply);
  if (reply.ok) {
    return { ok: true };
  }
  return { ok: false, reason: reply.reason ?? "capacity" };
}
