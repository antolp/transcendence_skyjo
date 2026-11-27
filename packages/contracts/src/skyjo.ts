import { z } from "zod";

export const SKYJO_BOARD_ROWS = 3;
export const SKYJO_BOARD_COLUMNS = 4;

export type SkyjoSeat = {
  playerId: string;
  username: string;
};

export type SkyjoPhase =
  | { kind: "setup" }
  | { kind: "turn"; playerId: string; step: "draw" | "resolve-draw" | "reveal" }
  | { kind: "round-end" }
  | { kind: "match-end" };

export type SkyjoPublicCard =
  | { kind: "hidden"; value?: never }
  | { kind: "revealed"; value: number }
  | { kind: "removed"; value?: never };

export type SkyjoPublicSeat = SkyjoSeat & {
  // Row-major slots. A removed card keeps its slot.
  board: readonly SkyjoPublicCard[];
  totalScore: number;
};

export type SkyjoRoundResult = {
  roundNumber: number;
  finisherId: string;
  scores: readonly { playerId: string; raw: number; awarded: number }[];
};

export type SkyjoPublicState = {
  roundNumber: number;
  phase: SkyjoPhase;
  seats: readonly SkyjoPublicSeat[];
  drawPileCount: number;
  discardTop: number | null;
  finisherId: string | null;
  history: readonly SkyjoRoundResult[];
};

const drawSourceSchema = z.enum(["deck", "discard"]);

export type SkyjoDrawnCard = {
  source: z.infer<typeof drawSourceSchema>;
  value: number;
};

export type SkyjoSeatState = {
  playerId: string;
  // Null when the viewing seat has no pending draw.
  drawnCard: SkyjoDrawnCard | null;
};

export type SkyjoSnapshot = {
  matchId: string;
  roomId: string;
  revision: number;
  public: SkyjoPublicState;
  // Spectators receive the public board and a null viewer state.
  you: SkyjoSeatState | null;
};

export type StartMatchResult = { matchId: string };

const slotIndexSchema = z.number().int().nonnegative()
  .max(SKYJO_BOARD_ROWS * SKYJO_BOARD_COLUMNS - 1);

const skyjoCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reveal"), slotIndex: slotIndexSchema }).strict(),
  z.object({ type: z.literal("draw"), source: drawSourceSchema }).strict(),
  z.object({ type: z.literal("swap"), slotIndex: slotIndexSchema }).strict(),
  z.object({ type: z.literal("discard") }).strict(),
  z.object({ type: z.literal("next-round") }).strict(),
]);
export type SkyjoCommand = z.infer<typeof skyjoCommandSchema>;

export const gameSubscribeSchema = z.object({ matchId: z.string().min(1) }).strict();
export type GameSubscribeRequest = z.infer<typeof gameSubscribeSchema>;

export const gameCommandSchema = gameSubscribeSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  command: skyjoCommandSchema,
});
export type GameCommandRequest = z.infer<typeof gameCommandSchema>;
