/**
 * Pure decision math for room votes — no Durable Object state, no I/O — so
 * the relay's rules are unit-testable without spinning up a runtime.
 */

/**
 * One ticket per nomination: repeated entries carry the weight, so a pack
 * three players picked is three times as likely as a single pick. The caller
 * supplies randomness (unit interval), keeping this deterministic to test.
 */
export function pickTicket<T>(tickets: readonly T[], random: () => number): T {
  if (tickets.length === 0) {
    throw new Error("pickTicket needs at least one ticket");
  }
  const index = Math.min(tickets.length - 1, Math.floor(random() * tickets.length));
  return tickets[index];
}

/** Unanimous consent: every present seat has voted. Empty rooms never pass. */
export function isUnanimous(votes: ReadonlySet<string>, playerIds: readonly string[]): boolean {
  return playerIds.length > 0 && playerIds.every((id) => votes.has(id));
}
