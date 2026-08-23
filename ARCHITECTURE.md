# GeoRumble Architecture

Collaborative Seterra-style geography quiz running as a [Discord Activity](https://docs.discord.com/developers/activities/overview): players in a voice channel share one game room, click regions together, and race the clock as a team.

```
┌───────────────────────────── Discord client ─────────────────────────────┐
│  voice channel                                                           │
│   └── Activity iframe (https://{clientId}.discordsays.com)               │
│        └── GeoRumble client (Vite/TS SPA)                                │
│             ├── Embedded App SDK: authorize → authenticate               │
│             └── Connection interface                                     │
│                  ├── SocketConnection  ── wss ──┐                        │
│                  └── LocalConnection (solo/dev) │                        │
└─────────────────────────────────────────────────│────────────────────────┘
                                                  │ (all traffic passes
┌────────────────────────── Cloudflare ───────────▼────────────────────────┐
│  Worker                                                                  │
│   ├── static assets (AppAssets binding ← client/dist)                    │
│   ├── POST /api/token      OAuth code exchange                           │
│   ├── GET  /api/health     liveness                                      │
│   └── GET  /api/room/{id}  WS upgrade                                    │
│        ├── RoomBroker (singleton DO) ── capacity gate ──► reject 4002    │
│        └── GameRoom (DO per instanceId) ── relay-only state              │
│                 ├── CloudflareRoomLimit (RoomLimitSource)                │
│                 │     ├── plan detection (subscriptions API)             │
│                 │     ├── MTD DO-request usage (GraphQL analytics)       │
│                 │     └── LIMITS_KV override (60s cache)                │
│                 └── hibernating WebSockets + alarm                       │
└──────────────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Client SPA | `client/src` | Auth handshake, map render, co-op click loop, all game rules |
| Connection seam | `client/src/net/connection.ts` | Transport-agnostic room link; game code never touches WebSocket directly |
| SocketConnection | `client/src/net/socketConnection.ts` | WebSocket impl against `/api/room/{roomId}` |
| LocalConnection | `client/src/net/localConnection.ts` | In-page loopback implementing room semantics for solo fallback and serverless dev |
| Worker entry | `worker/src/index.ts` | Routing, token exchange, broker gate before room upgrade |
| GameRoom DO | `worker/src/room.ts` | One per activity instance; membership/progress relay, host validation |
| RoomBroker DO | `worker/src/broker.ts` | Singleton live-room registry; admits or rejects NEW rooms |
| RoomLimitSource | `worker/src/capacity.ts` | Ceiling policy: KV override → plan quota vs measured usage |
| Shared protocol | `shared/protocol.ts` | Wire types; single source of truth across the boundary |
| MapPack contract | `shared/mappack.ts`, `docs/mappack-contract.md` | Regions as pure data |

## Identity and transport

- **roomId = Discord activity instance id.** Every participant in one voice-channel session shares it, so room lifecycle matches session lifecycle with no extra coordination. Outside Discord, browser sessions either play solo against the in-page loopback or join a human-typable `open:<CODE>` room.
- **Identity is self-asserted within a room, by design.** The `?player=` id and display name come from the client unauthenticated (Discord ids when embedded, random UUIDs otherwise); snapshots broadcast member ids. The trust boundary is the voice channel — everyone in an instance's session is mutually trusted, and instance verification guards the room boundary, not the player boundary. Hardening player identity (signed tokens minted at `/api/token`) is future work if rooms ever outlive that trust model.
- **Discord identity enrichment**: the `identify` scope supplies display name and avatar hash; the hash rides `hello{avatar}` onto the seat, and every client renders Discord avatars in the roster, live cursors, and victory scoreboard. Embedded sessions lock the name to the Discord identity (no rename UI); browser guests may rename.
- **All traffic goes through Discord's proxy** (`*.discordsays.com` fronts the configured URL mapping target). WebSockets are supported and must be `wss`; there is no WebRTC. The app must never send frame-ancestors/X-Frame-Options headers that exclude Discord domains.
- **Lobby roster** comes from the SDK (`getInstanceConnectedParticipants()` / instance-participant events), not from the relay; the relay only knows who has joined the *game*.
- OAuth: SDK `authorize()` returns a code client-side → client POSTs to `/api/token` → Worker exchanges it with `DISCORD_CLIENT_SECRET` → client calls `authenticate()`.

## WebSocket lifecycle

```
client                     worker                      RoomBroker        GameRoom DO
  │ GET /api/room/{id} (upgrade)              │              │                │
  │──────────────────────────────────────────►│── /admit ───►│                │
  │                                           │◄── ok/reject ─│                │
  │           ◄── reject: {t:"rejected"} + close 4002 ──► falls back to LocalConnection
  │                                           │── forward ────────────────────►│
  │ ◄──────────────────── 101, socket accepted, tagged player:{id} ────────────│
  │ {t:"hello", name} ────────────────────────────────────────────────────────►│
  │ ◄── {t:"welcome", you, snapshot} (+ {t:"host"} if first) ──────────────────│
  │ ◄── {t:"snapshot"} broadcast to everyone else                             │
```

Hibernation: the DO accepts sockets with `ctx.acceptWebSocket(server, tags)` where tags encode `player:{id}` and `room:{id}`, and registers an auto-response pair so `{t:"ping"}` is answered by the runtime with `{t:"pong"}` without waking the isolate. Idle rooms cost nothing between messages; identity survives eviction via serialized attachments, rehydrated in `ensureReady()` alongside persisted room state.

An alarm every 5 minutes (a) closes sockets that never sent `hello` (the 30 s intent is enforced at alarm granularity, so effectively ≤5 min — per-connection timers would defeat hibernation), (b) tears the room down when no sockets remain, and (c) heartbeats the broker so its registry reflects liveness.

## Room state machine

`lobby → playing → victory`, torn down when the last socket leaves.

- **Host election**: first player to `hello` becomes host (`hostId === null` → elect). Host authority means only the host's `start` / `verdict` / `advance` / `win` mutate shared progress; invalid attempts get `{t:"rejected", reason}` back, unprivileged ones get `reason:"not-host"`.
- **Host handoff**: on disconnect the earliest-joined remaining player inherits hostship and everyone receives `{t:"host", hostId}`. The donor is remembered (`lastHostId`/`roundHostId`), so a page refresh that closes the old socket before the new hello reclaims the crown instead of losing Start to a bystander.
- **Deterministic rounds**: the host generates the shuffled target order once and sends it in `start{packId, order[]}`; every client derives the current prompt from `snapshot.order[snapshot.orderIndex]`, so no per-client RNG divergence exists. The relay validates that order entries are unique non-empty strings.
- **Relay-owned clock**: `startedAt` is stamped by the DO on `start`; on `win` the finish time is re-derived from it rather than trusted from the hosting client. Guess counts stay client-reported.
- **Win integrity**: `win` is rejected unless phase is `playing` and `found.length >= order.length`.

### Message flows

```
start :  host ─► start{packId, order[]} ─► DO validates, phase=playing, stamps startedAt
                                          ─► broadcast snapshot(phase=playing)
guess :  any ─► guess{featureId} ─► broadcast guess (pure echo, no judgment)
verdict:  host ─► verdict{outcome{featureId,byPlayer,correct}} ─► DO appends to found[]
                  if correct, recomputes remaining ─► broadcast verified outcome
advance:  host ─► advance{index} ─► DO enforces forward-only movement
                  (a redundant index is absorbed silently — racing verdicts) ─► broadcast snapshot
win   :  host ─► win{seconds,guesses} ─► DO verifies completion, re-stamps seconds,
                                          phase=victory ─► broadcast win
cursor:  any ─► cursor{x,y in pack coords} ─► relayed to peers only (sender excluded),
                  never stored, throttled ~30/s per player
```

## Capacity gate

The gate answers exactly one question: *may a NEW room start?* Running games are never interrupted; joiners of a live room always pass (`broker.admit` short-circuits existing records).

```
/admit(roomId)
 ├─ existing record?  ── yes ─► refresh lastSeen, admit
 └─ new room
     ├─ sweep records whose lastSeen > 15 min old (orphan cleanup)
     ├─ limit = RoomLimitSource.limit()
     │    ├─ LIMITS_KV["limits"] override (number or {maxRooms})  ← zero-redeploy tuning
     │    ├─ else: subscriptions API → plan tier (free 10 / paid 500 rooms)
     │    │        + GraphQL analytics MTD DO requests → 0 rooms if burned through
     │    └─ 60 s cache, concurrent callers collapse onto one refresh
     ├─ live rooms ≥ limit?  ── yes ─► reject "capacity"
     └─ register room, admit
```

Buying the Workers Paid plan raises the ceiling on the next poll — no deploy. Absent credentials (local dev) resolve to unlimited. If the broker itself is unreachable, admission **fails open** so an outage degrades to unlimited rooms rather than taking games down; the gate is advisory by design.

**Reject path**: the upgrade is accepted, delivered `{t:"rejected", reason}`, then closed with `4002 CLOSE_CAPACITY`. Clients treat 4002 (and any socket failure, or absence of a Discord context) as the trigger for **solo fallback**: the same game loop runs against `LocalConnection`, an in-page implementation of room semantics behind the same `Connection` interface.

## Protocol reference

Wire format: bare JSON, one `ClientMessage` upstream / `ServerMessage` downstream per frame. Types live in `shared/protocol.ts` and are the single source of truth.

| Direction | Message | Meaning |
| --- | --- | --- |
| C→S | `hello {name, avatar?}` | Join/claim seat; optional Discord avatar hash; required soon after connect |
| C→S | `start {packId, order[]}` | Host begins a round with a fixed shuffled sequence |
| C→S | `guess {featureId}` | Player clicked a region (echoed to all) |
| C→S | `verdict {outcome}` | Host's ruling on a guess |
| C→S | `advance {index}` | Host moves the shared prompt forward |
| C→S | `win {seconds, guesses}` | Host declares completion (relay verifies) |
| C→S | `cursor {x, y}` | Pointer position in pack coordinates; relayed to peers, never stored |
| C→S | `ping` | Answered by runtime auto-response, never wakes the DO |
| S→C | `welcome {you, snapshot}` | Your seat + full room state |
| S→C | `snapshot {snapshot}` | Authoritative room state broadcast |
| S→C | `host {hostId}` | Election or handoff result |
| S→C | `guess {featureId, byPlayer}` | Relay echo |
| S→C | `verdict {outcome}` | Verified outcome incl. misses (`correct:false`) |
| S→C | `win {seconds, guesses}` | Victory, seconds relay-stamped |
| S→C | `cursor {byPlayer, x, y}` | Peer pointer relay (sender excluded) |
| S→C | `rejected {reason}` | Invalid action, not-host, capacity, malformed input |
| S→C | `pong` | Auto-response twin |

`Player` carries an optional `avatar` hash; clients render `cdn.discordapp.com` avatars where present and initials circles otherwise. Duplicate correct verdicts for an already-found region still broadcast (the late clicker gets their green flash) but never double-append `found` — scoring stays with the first finder.

Close codes: `4001` hello timeout / room closed · `4002` capacity rejected · `4003` room full (>30 participants) · `4004` room id not admissible (unknown instance, disabled scheme, or malformed).

**Room-id schemes** (`worker/src/roomIds.ts`): ids are namespaced by origin so paths cannot reach each other. Raw ids are Discord activity instances and pass bot-token verification; `open:<CODE>` ids are human-typable codes for browser play, admitted **only** when the `OPEN_ROOMS` variable is set — unset in production makes code rooms nonexistent server-side regardless of client support. Admission returns the canonical id (codes upper-cased) so every casing of a code lands in one Durable Object and one capacity slot. Both schemes share the broker capacity gate.

**Instance verification**: when `DISCORD_BOT_TOKEN` is configured, every `/api/room/{id}` upgrade is checked against Discord's `GET /applications/{id}/activity-instances/{instance_id}` before admission (`worker/src/instances.ts`), so a crafted client cannot hop into a private room by guessing ids. Definitive negatives (404) fail closed; indeterminate errors fail open, and positive results cache 60 s. Unconfigured (local dev) skips the check.

## Data: MapPacks

Regions are pure data (`docs/mappack-contract.md`, types in `shared/mappack.ts`). A pack carries stable feature ids, display names, aliases, and projection metadata; shipped packs are `us-states` (pre-projected Albers USA from public-domain `us-atlas`) and `europe` (39 countries, pre-projected conic conformal from public-domain Natural Earth data via `world-atlas`). The renderer plots coordinates directly — no reprojection — and pan/zoom plus auto-framing covers small-region hit areas. Adding a continent means adding a builder script's two artifacts and a manifest entry; no engine changes. Scripts: `scripts/fetch-mappacks.mjs`, `scripts/build-europe.mjs` (shared math in `scripts/lib/topo-utils.mjs`), validated by `scripts/validate-mappack.mjs` (`npm run packs:validate`).

## Versus mode (future)

The wire was shaped so versus is a scoring-policy layer, not a redesign: add `mode` + per-player `teamOf` to `start`, have the host emit team-scoped verdicts, and track per-team `foundByTeam` client-side. No new transports, no DO topology changes; the relay's membership/progress state already keys everything by player id.

## Development and deployment

- **Dev**: `docker compose up --build` runs the built client behind `wrangler dev` on `:8787` plus a `cloudflared` quick-tunnel sidecar; put the printed `trycloudflare.com` hostname under Activities → URL Mappings (prefix `/`) in the Developer Portal. Quick-tunnel hostnames rotate on recreation, so update the mapping after stack recreates.
- **Native WSL alternative**: `npm --prefix client run build && npm --prefix worker run dev`.
- **Deploy**: `cd worker && wrangler deploy`. Required secrets/bindings: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`; optional `DISCORD_BOT_TOKEN` enables instance verification (without it the anti-room-hop gate passes everything — dev posture), `LIMITS_KV` + `CF_ACCOUNT_ID`/`CF_API_TOKEN` enable the dynamic ceiling (otherwise unlimited), `OPEN_ROOMS=1` enables browser code rooms (leave unset for Discord-only).
- Both DO classes ship via the `v1` SQLite-backed migration in `worker/wrangler.jsonc`.

## Decision → code map

| Decision | Where |
| --- | --- |
| Co-op MVP, versus-extensible wire | `shared/protocol.ts` (order/orderIndex, per-player attribution) |
| Packs as pure data | `shared/mappack.ts`, `docs/mappack-contract.md` |
| Scale-to-zero economics | `worker/src/room.ts` (hibernation, auto-response, alarms) |
| Relay-only minimal state | `PersistedRoom` in `worker/src/room.ts` — membership/phase/progress only |
| Host-authoritative logic | `requireHost`/`denyHost` guards around mutating handlers |
| Dynamic capacity gate, KV-overridable | `worker/src/capacity.ts`, `worker/src/broker.ts` |
| New-room-only gating, finish-running-games | `RoomBroker.admit` existing-record short-circuit |
| Solo fallback, swappable transport | `Connection` in `client/src/net/connection.ts` |
| roomId = activity instanceId | client connection setup; `GameRoom` named-DO addressing |
| Instance verification (anti room-hopping) | `worker/src/instances.ts`, gate in `worker/src/index.ts` |
| Opt-in open room codes, scheme-namespaced ids | `shared/roomCodes.ts`, `worker/src/roomIds.ts`, client boot mode choice |
| Reconnect-with-backoff before solo degrade | `main.ts` reconnect policy + `GameClient.pauseForReconnect/degradeToSolo` |
| Miro-style presence cursors | `cursor` messages (`shared/protocol.ts`), `GameRoom.relayCursor`, `MapView` cursor layer |
| Seterra helpers: heat tiers, name reveal, tiny-region framing | `MapView.setFound/pressFeedback/zoomToRegion`, `GameClient.foundHeat` (wrong attempts to find each region), `main.ts` click label |
| Per-player victory scoreboard with Discord avatars | `GameClient.tallies`, `victoryScreen` score list |
| Legal pages for the Discord portal | `client/public/privacy.html`, `terms.html`, `/privacy` + `/terms` routes in `worker/src/index.ts` |

## Open questions

- `pending` sockets (connected but pre-`hello`) are tracked in memory only; after DO eviction their 30 s hello timeout is not enforced until the next message wakes the DO. Harmless today (they still can't act without `hello`), worth revisiting if ghost sockets ever consume seats.
- Broker heartbeats rely on the room alarm firing while occupied; a room whose players idle past 15 minutes without any socket traffic depends on hibernation keeping the alarm scheduled (it does, since alarms persist in storage), but this deserves a soak test.
- `monthStart()` buckets usage by UTC calendar month; Cloudflare billing cycles may differ by a day — conservative either way, cosmetic at most.
