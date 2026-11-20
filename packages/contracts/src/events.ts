import type { LobbyChangedEvent } from "./lobby.js";

// Shared event names prevent client/server protocol typos.
export const EVENTS = {
  LOBBY_JOIN: "lobby:join",
  LOBBY_CHANGED: "lobby:changed",
  LOBBY_KICKED: "lobby:kicked",
} as const;

// The join acknowledgement explicitly reports accepted/rejected membership.
export type Acknowledgement<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface ClientToServerEvents {
  "lobby:join": (
    command: { token: string },
    acknowledge: (result: Acknowledgement<{ playerId: string }>) => void,
  ) => void;
}

// Only publish revision notifications; personalized data comes from GET /state.
export interface ServerToClientEvents {
  "lobby:changed": (event: LobbyChangedEvent) => void;
  "lobby:kicked": () => void;
}

export interface InterServerEvents {}
export interface SocketData { lobbyPlayerId?: string }
