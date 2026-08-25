import assert from "node:assert/strict";
import { test } from "node:test";
import { planGhostSweep } from "../worker/src/ghost-sweep.ts";

const NOW = 1_000_000;
const GRACE = 20 * 60_000;
const STAMP = 10 * 60_000;

test("seats silent past the grace window are evicted", () => {
  const plan = planGhostSweep(
    [{ id: "ghost", lastSeenAt: NOW - GRACE - 1 }],
    new Set(),
    NOW,
    GRACE,
    STAMP,
  );
  assert.deepEqual(plan.ghosts, ["ghost"]);
  assert.equal(plan.stamps.size, 0);
});

test("seats inside the grace window stay", () => {
  const plan = planGhostSweep(
    [{ id: "flaky", lastSeenAt: NOW - GRACE + 1_000 }],
    new Set(),
    NOW,
    GRACE,
    STAMP,
  );
  assert.deepEqual(plan.ghosts, []);
});

test("unstamped legacy seats are stamped, never evicted on first sight", () => {
  const plan = planGhostSweep([{ id: "legacy" }], new Set(), NOW, GRACE, STAMP);
  assert.deepEqual(plan.ghosts, []);
  assert.deepEqual([...plan.stamps.keys()], ["legacy"]);
});

test("live seats restamp at most once per stamp interval", () => {
  const plan = planGhostSweep(
    [
      { id: "stale", lastSeenAt: NOW - STAMP - 1 },
      { id: "fresh", lastSeenAt: NOW - STAMP + 1 },
    ],
    new Set(["stale", "fresh"]),
    NOW,
    GRACE,
    STAMP,
  );
  assert.deepEqual([...plan.stamps.keys()], ["stale"]);
});

test("a dead seat past both thresholds is evicted rather than refreshed", () => {
  // Eviction wins over restamping — otherwise the seat would reset its own
  // eviction clock every alarm and linger forever just past the interval.
  const plan = planGhostSweep(
    [{ id: "gone", lastSeenAt: NOW - GRACE - 1 }],
    new Set(),
    NOW,
    GRACE,
    STAMP,
  );
  assert.deepEqual(plan.ghosts, ["gone"]);
  assert.equal(plan.stamps.size, 0);
});

test("a dead seat inside grace but past the stamp interval is left alone", () => {
  // Not fresh enough to restamp (no live socket), not stale enough to evict:
  // its old timestamp keeps aging toward the threshold untouched.
  const plan = planGhostSweep(
    [{ id: "quiet", lastSeenAt: NOW - STAMP - 1 }],
    new Set(),
    NOW,
    GRACE,
    STAMP,
  );
  assert.deepEqual(plan.ghosts, []);
  assert.equal(plan.stamps.size, 0);
});
