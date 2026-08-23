export type Player = {
  id: string;
  name: string;
};

export type Phase = "lobby" | "playing" | "victory";

export type RoomSnapshot = {
  hostId: string | null;
  players: Player[];
  phase: Phase;
  packId: string | null;
  /** Full shuffled feature order fixed at start; identical on every client. */
  order: string[];
  /** Index into `order` of the shared prompt; null while not playing. */
  orderIndex: number | null;
  found: string[];
  /** Derived convenience: order[orderIndex], null when out of game. */
  target: string | null;
  startedAt: number | null;
};

export type GuessOutcome = {
  featureId: string;
  byPlayer: string;
  /** False broadcasts a miss so every client renders it and accuracy stays computable. */
  correct: boolean;
  remaining: number;
};

export type ClientMessage =
  | { t: "hello"; name: string }
  | { t: "ping" }
  | { t: "start"; packId: string; order: string[] }
  | { t: "guess"; featureId: string }
  | { t: "verdict"; outcome: GuessOutcome }
  | { t: "advance"; index: number }
  | { t: "win"; seconds: number; guesses: number };

export type ServerMessage =
  | { t: "welcome"; you: string; snapshot: RoomSnapshot }
  | { t: "snapshot"; snapshot: RoomSnapshot }
  | { t: "host"; hostId: string }
  | { t: "guess"; featureId: string; byPlayer: string }
  | { t: "verdict"; outcome: GuessOutcome }
  | { t: "win"; seconds: number; guesses: number }
  | { t: "rejected"; reason: string }
  | { t: "pong" };

/**
 * Close codes used when the server ends a socket. 4002 is referenced by
 * `rejected` above: capacity-rejected rooms accept the socket, deliver the
 * message, then close with this code so both structured and transport-level
 * signals agree.
 */
export const CLOSE_CAPACITY = 4002;
export const CLOSE_ROOM_FULL = 4003;
export const CLOSE_HELLO_TIMEOUT = 4001;
export const CLOSE_UNVERIFIED = 4004;
