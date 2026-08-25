import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnanimous, pickTicket } from "../worker/src/vote-math.ts";

test("pickTicket returns the only ticket", () => {
  assert.equal(pickTicket(["a"], () => 0.99), "a");
});

test("pickTicket maps the unit interval onto tickets in order", () => {
  const tickets = ["a", "b", "c"];
  assert.equal(pickTicket(tickets, () => 0.0), "a");
  assert.equal(pickTicket(tickets, () => 0.33), "a");
  assert.equal(pickTicket(tickets, () => 0.34), "b");
  assert.equal(pickTicket(tickets, () => 0.66), "b");
  assert.equal(pickTicket(tickets, () => 0.67), "c");
});

test("pickTicket clamps the extreme end of the interval", () => {
  assert.equal(pickTicket(["a", "b"], () => 1), "b");
});

test("pickTicket repeats carry weight: 3 tickets of x always win over 1 of y", () => {
  const tickets = ["x", "x", "x", "y"];
  for (const value of [0, 0.2, 0.5, 0.74]) {
    assert.equal(pickTicket(tickets, () => value), "x");
  }
  assert.equal(pickTicket(tickets, () => 0.75), "y");
});

test("pickTicket rejects an empty ticket pool", () => {
  assert.throws(() => pickTicket([], () => 0.5));
});

test("isUnanimous requires every seat to have voted", () => {
  assert.equal(isUnanimous(new Set(["a"]), ["a"]), true);
  assert.equal(isUnanimous(new Set(["a"]), ["a", "b"]), false);
  assert.equal(isUnanimous(new Set(["a", "b"]), ["a", "b"]), true);
});

test("isUnanimous never passes for an empty room", () => {
  assert.equal(isUnanimous(new Set(), []), false);
});

test("isUnanimous ignores votes from seats that left", () => {
  assert.equal(isUnanimous(new Set(["a", "ghost"]), ["a"]), true);
});
