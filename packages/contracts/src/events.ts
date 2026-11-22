import type { LobbyChangedEvent } from "./lobby.js";
import type { GameCommandRequest, GameSubscribeRequest, SkyjoSnapshot } from "./skyjo.js";

// Shared event names prevent client/server protocol typos.
export const EVENTS = {
  LOBBY_JOIN: "lobby:join",
  LOBBY_CHANGED: "lobby:changed",
  LOBBY_KICKED: "lobby:kicked",
  GAME_SUBSCRIBE: "game:subscribe",
  GAME_COMMAND: "game:command",
  GAME_SNAPSHOT: "game:snapshot",
} as const;

export type Acknowledgement<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type GameSubscribeAck = Acknowledgement<SkyjoSnapshot>;
// On success, revision is the version produced by the command.
export type GameCommandAck = Acknowledgement<{ revision: number }>;

export interface ClientToServerEvents {
  "lobby:join": (
    command: { token: string },
    acknowledge: (result: Acknowledgement<{ playerId: string }>) => void,
  ) => void;
  // After lobby:join, resolve socket.data.lobbyPlayerId against the match roster.
  [EVENTS.GAME_SUBSCRIBE]: (
    request: GameSubscribeRequest,
    acknowledge: (result: GameSubscribeAck) => void,
  ) => void;
  // Apply commands for that seat. Reject a mismatched expectedRevision with STALE_REVISION.
  [EVENTS.GAME_COMMAND]: (
    request: GameCommandRequest,
    acknowledge: (result: GameCommandAck) => void,
  ) => void;
}

export interface ServerToClientEvents {
  "lobby:changed": (event: LobbyChangedEvent) => void;
  "lobby:kicked": () => void;
  // Send the full personalized snapshot to the viewing seat's sockets.
  [EVENTS.GAME_SNAPSHOT]: (snapshot: SkyjoSnapshot) => void;
}

export interface InterServerEvents {}
export interface SocketData { lobbyPlayerId?: string }
