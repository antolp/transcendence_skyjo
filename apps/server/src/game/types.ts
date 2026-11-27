import type { SkyjoCommand, SkyjoRoundResult, SkyjoDrawnCard, SkyjoPhase, SkyjoSeat, SkyjoSnapshot, StartMatchResult } from "@ft/contracts";

export type StartMatchInput = {
  roomId: string;
  // Seats are ordered and use the lobby's authenticated player IDs.
  seats: readonly SkyjoSeat[];
};

export type StartMatch = (input: StartMatchInput) => Promise<StartMatchResult>;

export type ActiveMatch = {
  matchId: string;
  snapshotFor(playerId: string): SkyjoSnapshot;
  command(playerId: string, expectedRevision: number, command: SkyjoCommand): number;
};

export type MatchService = {
  startMatch: StartMatch;
  readonly activeMatch: ActiveMatch | null;
};

type SkyjoPrivateSeat = SkyjoSeat & {
  // Row-major slots. Null marks a removed card.
  board: ({ value: number; revealed: boolean } | null)[];
  totalScore: number;
};

// Authoritative server state, including values of face-down cards and both piles.
export type SkyjoPrivateState = {
  matchId: string;
  roomId: string;
  revision: number;
  roundNumber: number;
  phase: SkyjoPhase;
  seats: SkyjoPrivateSeat[];
  drawPile: number[];
  discardPile: number[];
  finisherId: string | null;
  history: SkyjoRoundResult[];
  pendingDraw: (SkyjoDrawnCard & { playerId: string }) | null;
};
