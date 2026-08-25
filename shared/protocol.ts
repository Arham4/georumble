export type Player = {
  id: string;
  name: string;
  /** Discord avatar hash when the seat is authenticated; absent for guests. */
  avatar?: string | null;
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
  /** Wrong attempts it took to find each found region, by feature id. */
  heat?: Record<string, number>;
  /** Per-player round tallies, by player id — survives rejoin. */
  tallies?: Record<string, { correct: number; misses: number }>;
  /** Who found each found region, by feature id — drives the finder badge. */
  foundBy?: Record<string, string>;
  /** Seats that voted to return to the lobby; unanimous consent ends the round. */
  lobbyVotes?: string[];
  /** Lobby map nominations, by player id — feeds the democratic random pick. */
  packVotes?: Record<string, string>;
  /** Relay-clock ms when the open nominations roll into a random choice. */
  packVoteDeadline?: number;
  /** The rolled winner; clients play the reveal, then the host starts it. */
  chosenPackId?: string;
  /** Whether the round grants the miss-streak hint; host's choice at start. */
  hintsEnabled?: boolean;
  /** Derived convenience: order[orderIndex], null when out of game. */
  target: string | null;
  startedAt: number | null;
  /**
   * Relay clock at snapshot time. startedAt lives on the relay's clock, so
   * clients anchor an offset against this instead of assuming NTP-perfect
   * devices; absent on pre-serverNow relays, which falls back to local time.
   */
  serverNow?: number;
};

export type GuessOutcome = {
  featureId: string;
  byPlayer: string;
  /** False broadcasts a miss so every client renders it and accuracy stays computable. */
  correct: boolean;
  remaining: number;
};

export type ClientMessage =
  | { t: "hello"; name: string; avatar?: string | null }
  | { t: "ping" }
  | { t: "start"; packId: string; order: string[]; hints?: boolean }
  | { t: "guess"; featureId: string }
  | { t: "verdict"; outcome: GuessOutcome }
  | { t: "advance"; index: number }
  | { t: "win"; seconds: number; guesses: number }
  /** Host-only: leave victory (or abort a round) and reopen the map picker. */
  | { t: "lobby" }
  /** Any player: toggle a vote to send everyone back to the map picker. */
  | { t: "vote-lobby" }
  /** Lobby: nominate a map for the democratic random roll. */
  | { t: "pack-vote"; packId: string }
  /** Lobby: nudge the relay to roll nominations whose deadline has passed. */
  | { t: "pack-vote-resolve" }
  /** Pointer position in pack coordinates; relayed live, never stored. */
  | { t: "cursor"; x: number; y: number };

export type ServerMessage =
  | { t: "welcome"; you: string; snapshot: RoomSnapshot }
  | { t: "snapshot"; snapshot: RoomSnapshot }
  | { t: "host"; hostId: string }
  | { t: "guess"; featureId: string; byPlayer: string }
  | { t: "verdict"; outcome: GuessOutcome }
  | { t: "win"; seconds: number; guesses: number; wheelSeed?: number }
  | { t: "cursor"; byPlayer: string; x: number; y: number }
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
