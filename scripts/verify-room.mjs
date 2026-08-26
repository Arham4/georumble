#!/usr/bin/env node
// Live relay verification against a running worker (local dev or production).
// Exercises the message contracts that TypeScript cannot check: pack-vote
// snapshots, deadline presence, resolve-before-deadline refusal, unanimous
// vote-to-lobby, and the open-room / Discord-instance namespace split.
//
// Usage: node scripts/verify-room.mjs [wsBase]
//   wsBase default: wss://georumble.losers-lab.workers.dev/api/room
//   Local dev:      ws://localhost:8787/api/room  (wrangler dev --var OPEN_ROOMS:true)
//
// Exits 0 only when every assertion holds.
const BASE = process.argv[2] ?? "wss://georumble.losers-lab.workers.dev/api/room";
const ROOM = `${BASE}/open:VER234`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(playerId, name) {
  const ws = new WebSocket(`${ROOM}?player=${playerId}`);
  const log = [];
  ws.addEventListener("open", () => ws.send(JSON.stringify({ t: "hello", name })));
  ws.addEventListener("message", (event) => log.push(JSON.parse(event.data)));
  return { ws, log };
}

const latest = (log) => log.filter((m) => m.t === "welcome" || m.t === "snapshot").at(-1)?.snapshot;

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "✔" : "✖"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const alice = connect("vrAlice", "Alice");
await sleep(1500);

// A lone seat nominating is a pre-selection, not a countdown: no window,
// no roll — they just press Start on their own pick.
alice.ws.send(JSON.stringify({ t: "pack-vote", packId: "europe" }));
await sleep(800);
{
  const snap = latest(alice.log);
  check(
    "solo nomination sits windowless",
    snap?.packVotes?.vrAlice === "europe" && typeof snap?.packVoteDeadline !== "number",
  );
}

const bob = connect("vrBob", "Bob");
await sleep(2000);
check(
  "the second seat starts the countdown",
  typeof latest(alice.log)?.packVoteDeadline === "number",
);

bob.ws.send(JSON.stringify({ t: "pack-vote", packId: "asia" }));
await sleep(1000);
{
  // With every seat having voted, participation is complete and the roll
  // fires immediately (weighted, so differing picks are fine).
  const a = latest(alice.log);
  check("pack vote reaches the other seat", a?.packVotes?.vrBob === "asia" && a?.packVotes?.vrAlice === "europe");
  check(
    "full participation rolls instantly",
    typeof a?.chosenPackId === "string" &&
      latest(bob.log)?.chosenPackId === a.chosenPackId,
  );
}

// Reset and test the expiry path: start the rolled pack, then abandon it via
// unanimous vote-to-lobby — that lands on a clean picker ballot. One
// nomination in a crowd where nobody else votes follows; only the relay's
// own alarm may resolve it.
const rolled = latest(alice.log)?.chosenPackId;
alice.ws.send(JSON.stringify({ t: "start", packId: rolled, order: ["f1", "f2"] }));
await sleep(600);
alice.ws.send(JSON.stringify({ t: "vote-lobby" }));
bob.ws.send(JSON.stringify({ t: "vote-lobby" }));
await sleep(800);
check(
  "started-and-abandoned round leaves a clean picker",
  latest(alice.log)?.phase === "lobby" && latest(alice.log)?.chosenPackId === undefined,
);

alice.ws.send(JSON.stringify({ t: "pack-vote", packId: "europe" }));
await sleep(800);
check(
  "a crowd nomination opens the window",
  typeof latest(alice.log)?.packVoteDeadline === "number",
);

bob.ws.send(JSON.stringify({ t: "pack-vote-resolve" }));
await sleep(800);
check("resolve before the deadline is refused", latest(alice.log)?.chosenPackId === undefined);

// The roll must fire from the relay's own alarm at the deadline: nobody
// sends another nudge here, and both sockets sit idle past expiry. This is
// what resolves an all-backgrounded room.
const deadline = latest(alice.log)?.packVoteDeadline;
check("deadline still pending before expiry", typeof deadline === "number");
await sleep(Math.max(0, deadline - Date.now() + 6000));
check(
  "relay alarm rolls the map at the deadline with no client nudge",
  typeof latest(alice.log)?.chosenPackId === "string",
);
check(
  "rolled choice lands on the other seat too",
  latest(bob.log)?.chosenPackId === latest(alice.log)?.chosenPackId,
);

// Unanimous vote-to-lobby is a no-op in the lobby phase; verify the message
// is at least accepted without a rejection broadcast.
const before = alice.log.length;
alice.ws.send(JSON.stringify({ t: "vote-lobby" }));
await sleep(600);
check(
  "vote-lobby in lobby phase is absorbed silently",
  alice.log.slice(before).every((m) => m.t !== "rejected"),
);

// Namespace split: a fabricated Discord instance id must never admit. The
// upgrade completes before the worker closes it, so the signal is the CLOSE
// code — resolving on "open" would race and always lose.
const intruder = new WebSocket(`${BASE}/fake-instance-xyz?player=vrMallory`);
const intruderClose = await new Promise((resolve) => {
  intruder.addEventListener("close", (event) => resolve(`${event.code} ${event.reason}`));
  setTimeout(() => resolve("timeout"), 8000);
});
check(
  "fake instance id is refused at the door",
  intruderClose.startsWith("4004"),
  `got "${intruderClose}"`,
);

alice.ws.close();
bob.ws.close();

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nroom contract verified");
