import assert from "node:assert/strict";
import { test } from "node:test";
import { GameClient, type GameState, type ServerMessage } from "../client/src/game/gameClient.ts";

type Harness = {
  client: GameClient;
  states: GameState[];
  send: <T extends ServerMessage>(message: T) => void;
};

/**
 * The client's brain with no transport: messages are fed straight into
 * onMessage and every emitted state is captured for assertions.
 */
function harness(name: string): Harness {
  const states: GameState[] = [];
  const sent: ServerMessage[] = [];
  const client = new GameClient(
    {
      onState: (state) => states.push(state),
      onVerdict: () => undefined,
      onLinkLost: () => undefined,
      onPeerCursor: () => undefined,
    },
    name,
    null,
  );
  return {
    client,
    states,
    send: (message) => {
      sent.push(message);
      client.onMessage(message);
    },
  };
}

const baseSnapshot = {
  hostId: "p1",
  players: [{ id: "p1", name: "Tester" }],
  phase: "lobby" as const,
  packId: "europe",
  order: ["f1", "f2", "f3"],
  orderIndex: null,
  found: [],
  target: null,
  startedAt: null,
  serverNow: 1_000,
};

test("verdicts score finds, misses, and the finder map", () => {
  const h = harness("Tester");
  h.send({ t: "welcome", you: "p1", snapshot: { ...baseSnapshot } });
  h.send({
    t: "snapshot",
    snapshot: { ...baseSnapshot, phase: "playing", orderIndex: 0, target: "f1", startedAt: 500 },
  });
  h.send({
    t: "verdict",
    outcome: { featureId: "f9", byPlayer: "p1", correct: false, remaining: 3 },
  });
  h.send({
    t: "verdict",
    outcome: { featureId: "f1", byPlayer: "p1", correct: true, remaining: 2 },
  });
  const last = h.states.at(-1)!;
  assert.equal(last.correct, 1);
  assert.equal(last.misses, 1);
  assert.equal(last.foundIds.length, 1);
  assert.deepEqual(last.foundBy, { f1: "p1" });
  assert.deepEqual(last.scoreboard[0], {
    id: "p1",
    name: "Tester",
    avatar: null,
    isYou: true,
    correct: 1,
    misses: 1,
  });
  h.client.dispose();
});

test("hint activates after three misses on one target, and only when enabled", () => {
  const h = harness("Tester");
  h.send({ t: "welcome", you: "p1", snapshot: { ...baseSnapshot } });
  const playing = {
    ...baseSnapshot,
    phase: "playing" as const,
    orderIndex: 0,
    target: "f1",
    startedAt: 500,
  };
  h.send({ t: "snapshot", snapshot: { ...playing } });
  for (let i = 0; i < 3; i++) {
    h.send({
      t: "verdict",
      outcome: { featureId: "f9", byPlayer: "p1", correct: false, remaining: 3 },
    });
  }
  assert.equal(h.states.at(-1)!.hintActive, true);

  // Host started a hints-off round: same miss history, no hint.
  h.send({
    t: "snapshot",
    snapshot: { ...playing, startedAt: 999, hintsEnabled: false },
  });
  h.send({
    t: "verdict",
    outcome: { featureId: "f9", byPlayer: "p1", correct: false, remaining: 3 },
  });
  h.send({
    t: "verdict",
    outcome: { featureId: "f9", byPlayer: "p1", correct: false, remaining: 3 },
  });
  h.send({
    t: "verdict",
    outcome: { featureId: "f9", byPlayer: "p1", correct: false, remaining: 3 },
  });
  assert.equal(h.states.at(-1)!.hintActive, false);
  h.client.dispose();
});

test("a new round key resets per-round state but keeps the seat", () => {
  const h = harness("Tester");
  h.send({ t: "welcome", you: "p1", snapshot: { ...baseSnapshot } });
  h.send({
    t: "snapshot",
    snapshot: { ...baseSnapshot, phase: "playing", orderIndex: 0, target: "f1", startedAt: 500 },
  });
  h.send({
    t: "verdict",
    outcome: { featureId: "f1", byPlayer: "p1", correct: true, remaining: 2 },
  });
  assert.equal(h.states.at(-1)!.correct, 1);
  h.send({
    t: "snapshot",
    snapshot: { ...baseSnapshot, phase: "playing", orderIndex: 0, target: "f1", startedAt: 42_000 },
  });
  const fresh = h.states.at(-1)!;
  assert.equal(fresh.correct, 0);
  assert.equal(fresh.foundIds.length, 0);
  assert.deepEqual(fresh.foundBy, {});
  h.client.dispose();
});

test("the win message carries the relay's wheel seed into state", () => {
  const h = harness("Tester");
  h.send({ t: "welcome", you: "p1", snapshot: { ...baseSnapshot } });
  h.send({ t: "win", seconds: 61, guesses: 40, wheelSeed: 123456789 });
  const last = h.states.at(-1)!;
  assert.equal(last.phase, "victory");
  assert.equal(last.win?.wheelSeed, 123456789);
  h.client.dispose();
});

test("pack votes and the chosen pack ride snapshots into state", () => {
  const h = harness("Tester");
  h.send({
    t: "welcome",
    you: "p1",
    snapshot: {
      ...baseSnapshot,
      packVotes: { p1: "europe", p2: "asia" },
      packVoteDeadline: 5_000,
    },
  });
  let last = h.states.at(-1)!;
  assert.deepEqual(last.packVotes, { p1: "europe", p2: "asia" });
  assert.equal(last.packVoteDeadline, 5_000);
  h.send({
    t: "snapshot",
    snapshot: { ...baseSnapshot, chosenPackId: "asia" },
  });
  last = h.states.at(-1)!;
  assert.equal(last.chosenPackId, "asia");
  h.client.dispose();
});

test("a refresh mid-victory crowns the same player via the snapshot seed", () => {
  const h = harness("Tester");
  // The rejoined client never saw the one-shot win broadcast; the victory
  // snapshot must carry the relay's seed on its own.
  h.send({
    t: "welcome",
    you: "p1",
    snapshot: { ...baseSnapshot, phase: "victory", wheelSeed: 987654321 },
  });
  const last = h.states.at(-1)!;
  assert.equal(last.wheelSeed, 987654321);
  assert.equal(last.win, null);
  h.client.dispose();
});

test("routine snapshots omit the order and the client carries it forward", () => {
  const h = harness("Tester");
  h.send({ t: "welcome", you: "p1", snapshot: { ...baseSnapshot } });
  h.send({
    t: "snapshot",
    snapshot: {
      ...baseSnapshot,
      phase: "playing",
      orderIndex: 0,
      target: "f1",
      startedAt: 500,
    },
  });
  // The starting snapshot carried the order; the relay stops re-shipping it.
  const light = { ...baseSnapshot, order: undefined };
  delete (light as { order?: unknown }).order;
  h.send({
    t: "snapshot",
    snapshot: { ...light, phase: "playing", orderIndex: 1, target: "f2", startedAt: 500 },
  });
  assert.deepEqual(h.states.at(-1)!.foundIds, []);
  // orderLength feeds HUD stats; dropping it mid-round would zero them.
  const { orderLength } = h.states.at(-1)!;
  assert.equal(orderLength, 3);
  // Back to lobby is a fresh slate: the old round's order must not leak in.
  h.send({
    t: "snapshot",
    snapshot: { ...light, phase: "lobby", orderIndex: null, target: null, startedAt: null },
  });
  assert.equal(h.states.at(-1)!.orderLength, 0);
  h.client.dispose();
});
