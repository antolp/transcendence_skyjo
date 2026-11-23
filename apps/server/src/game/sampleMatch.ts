import { randomUUID } from "node:crypto";
import type { SkyjoPublicState, SkyjoSeatState } from "@ft/contracts";
import { skyjoSnapshotSample } from "@ft/contracts/samples/skyjo";
import { LobbyError } from "../lobby/errors.js";
import type { ActiveMatch, MatchService } from "./types.js";

export function createSampleMatchService(onStart: (match: ActiveMatch) => void): MatchService {
  let activeMatch: ActiveMatch | null = null;

  return {
    get activeMatch() { return activeMatch; },

    async startMatch({ roomId, seats }) {
      if (activeMatch) return { matchId: activeMatch.matchId };
      const [first, second] = seats;
      if (!first || !second) {
        throw new LobbyError("NOT_ENOUGH_PLAYERS", "At least two guests must join before starting.", 409);
      }

      const matchId = randomUUID();
      const sample = skyjoSnapshotSample;
      const publicState: SkyjoPublicState = {
        ...sample.public,
        phase: { ...sample.public.phase, playerId: first.playerId },
        seats: [
          { ...sample.public.seats[0], playerId: first.playerId, username: first.username },
          { ...sample.public.seats[1], playerId: second.playerId, username: second.username },
        ],
      };
      activeMatch = {
        matchId,
        snapshotFor(playerId) {
          let you: SkyjoSeatState | null = null;
          if (playerId === first.playerId) you = { playerId, drawnCard: sample.you.drawnCard };
          else if (playerId === second.playerId) you = { playerId, drawnCard: null };
          return { matchId, roomId, revision: sample.revision, public: publicState, you };
        },
      };
      onStart(activeMatch);
      return { matchId };
    },
  };
}
