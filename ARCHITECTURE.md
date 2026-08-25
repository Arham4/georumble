# GeoRumble architecture

One Discord Activity + browser game: a static client, a Worker, and two
Durable Object classes. This doc is the free-tier scaling model — what each
live room costs, what breaks first, and which levers exist.

## Topology

```
browser / Discord activity
  │  static assets (client/dist) + /api/*
  ▼
Worker ──► GameRoom DO        one per room; relay + round bookkeeping
  │         │  hibernating WebSockets, storage-backed state
  │         ▼
  │       RoomBroker DO       singleton; live-room registry, capacity gate
  │                           (TTL sweep, LIMITS_KV retunable limit)
  ▼
LIMITS_KV                     optional room-capacity override without redeploy
```

- **GameRoom** (`worker/src/room.ts`): owns membership, phase, round state,
  and the vote systems (unanimous leave, democratic map roll — the roll fires
  from the DO alarm at the nomination deadline, so an all-backgrounded room
  still resolves; client nudges only make it snappier). The same alarm sweeps
  ghost seats (players whose socket died without a close frame) after a grace
  window, so vanished apps never hold the roster cap. The hosting
  *client* adjudicates guesses; the relay verifies and persists the results.
- **Snapshot weight policy**: routine snapshots omit the round order (every
  seat already holds it from their welcome or the starting broadcast), and
  anything players see simultaneously is decided relay-side and persisted —
  never derived per-client.
- **RoomBroker** (`worker/src/broker.ts`): admits new rooms up to a limit,
  sweeps records whose alarm stopped beating. Capacity gates *new* rooms
  only — joiners of a live room always pass.
- **Room identity namespaces**: Discord instances (verified against the API,
  unguessable) and `open:` browser codes (6-char alphabet without ambiguous
  glyphs) never intersect. Embedded clients never join open rooms.

## Free-tier cost accounting

| Cost                       | Driver                                   | Mitigation in place |
| -------------------------- | ---------------------------------------- | ------------------- |
| DO requests                | every handled WS message bills once      | pings answered by `setWebSocketAutoResponse` (free); cursors floored at 150ms client / 150ms relay (stretching with roster), and not relayed at all without an audience; non-cursor floods hit a burst bucket |
| DO duration                | wall-clock while awake                   | hibernation: idle sockets cost nothing between messages |
| DO storage writes          | one `persist()` per state mutation       | whole-room blob per put; mutations are player-paced (guesses, votes), not machine-paced; no-op mutations (repeat nominations, duplicate verdicts) skip the write |
| Alarms                     | one per occupied room per 10 min         | doubles as ghost-seat sweep + broker heartbeat; hello deadlines and nomination rolls arm sooner beats that stay write-free |
| Worker requests            | asset + API traffic                      | static assets are cached; API surface is tiny |

The dominant live cost is cursor relaying during active rounds — hence the
audience check and the raised floors. Next lever if needed: raise floors
further (clients lerp, so 10/s still looks smooth) or disable cursors
entirely under a capacity signal from `LIMITS_KV`.

## What breaks first, in order

1. **DO request volume** from simultaneous active rooms — mitigated as above;
   the broker's capacity gate is the circuit breaker.
2. **Snapshot payload size** — routine snapshots already omit the round
   order (shipped once per seat in the welcome / starting broadcast); what
   remains scales with roster and found-list length. Fine today.
3. **Broker registry growth** — TTL sweep bounds it; records die 30 min
   after their last heartbeat.

## Module seams

- `shared/protocol.ts` — the wire contract; both sides import it.
- `shared/pack-manifest.ts` — the single list of shippable packs; the client
  renders its picker from it and the relay validates votes against it, so a
  stale client can never nominate a pack nobody can load.
- `worker/src/vote-math.ts` — pure decision math (weighted roll, unanimity),
  unit-tested without a DO runtime.
- `shared/mappack.ts` + `scripts/lib/mappack-contract.mjs` — pack contract
  and its validator; builders are convention-discovered
  (`scripts/run-packs-build.mjs`).
- Client split: `game/gameClient.ts` (state machine), `game/shuffle.ts`
  (the one seeded PRNG — round order and the carry wheel draw from it so
  every screen replays identically), `map/mapView.ts`
  (rendering/camera; all constant-on-screen sizing flows through one
  camera helper), `net/*` (socket vs in-browser loopback speaking the
  same contract), `ui/*` (screens).
- Relay-owned determinism rule: anything players see simultaneously (roll
  winner, carry-wheel crown) is decided server-side and persisted in the
  snapshot — never derived per-client from local randomness.
