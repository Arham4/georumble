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
  found: string[];
  target: string | null;
  startedAt: number | null;
};

export type GuessOutcome = {
  featureId: string;
  byPlayer: string;
  remaining: number;
};

export type ClientMessage =
  | { t: "hello"; name: string }
  | { t: "start"; packId: string; target: string }
  | { t: "guess"; featureId: string }
  | { t: "verdict"; outcome: GuessOutcome }
  | { t: "advance"; target: string }
  | { t: "win"; seconds: number; guesses: number };

export type ServerMessage =
  | { t: "welcome"; you: string; snapshot: RoomSnapshot }
  | { t: "snapshot"; snapshot: RoomSnapshot }
  | { t: "guess"; featureId: string; byPlayer: string }
  | { t: "verdict"; outcome: GuessOutcome }
  | { t: "win"; seconds: number; guesses: number }
  | { t: "rejected"; reason: string };
