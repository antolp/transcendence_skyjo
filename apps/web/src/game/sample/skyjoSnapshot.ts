import { LOBBY_ROOM_ID, type SkyjoSnapshot } from "@ft/contracts";

const alexId = "00000000-0000-4000-8000-000000000001";
const samId = "00000000-0000-4000-8000-000000000002";

export const skyjoSnapshotSample: SkyjoSnapshot = {
  matchId: "sample-match",
  roomId: LOBBY_ROOM_ID,
  revision: 18,
  public: {
    roundNumber: 1,
    phase: { kind: "turn", playerId: alexId, step: "resolve-draw" },
    seats: [
      {
        playerId: alexId,
        username: "Alex",
        totalScore: 0,
        board: [
          { kind: "removed" }, { kind: "revealed", value: -1 }, { kind: "hidden" }, { kind: "hidden" },
          { kind: "removed" }, { kind: "revealed", value: 5 }, { kind: "hidden" }, { kind: "hidden" },
          { kind: "removed" }, { kind: "hidden" }, { kind: "revealed", value: 8 }, { kind: "hidden" },
        ],
      },
      {
        playerId: samId,
        username: "Sam",
        totalScore: 0,
        board: [
          { kind: "hidden" }, { kind: "revealed", value: 5 }, { kind: "hidden" }, { kind: "hidden" },
          { kind: "hidden" }, { kind: "hidden" }, { kind: "hidden" }, { kind: "revealed", value: 6 },
          { kind: "hidden" }, { kind: "hidden" }, { kind: "hidden" }, { kind: "hidden" },
        ],
      },
    ],
    drawPileCount: 119,
    discardTop: 7,
  },
  you: { playerId: alexId, drawnCard: { source: "deck", value: 2 } },
};
