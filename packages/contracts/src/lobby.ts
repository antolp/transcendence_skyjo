import { z } from "zod";

// This prototype has exactly one persisted lobby; both applications use its ID.
export const LOBBY_ROOM_ID = "demo" as const;

// Validate untrusted browser input at the API boundary (2-30 visible characters).
export const usernameSchema = z.string().trim().min(2).max(30)
export const registerLobbySchema = z.object({ username: usernameSchema }).strict();
// Validate moderation targets and socket-join payloads before trusting them.
export const playerIdSchema = z.string().uuid();
export const kickPlayerSchema = z.object({ playerId: playerIdSchema }).strict();

// Guest credentials are 32 random bytes encoded as 64 lowercase hex characters.
export const lobbyTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const joinLobbySchema = z.object({ token: lobbyTokenSchema }).strict();

export type LobbyPlayer = { id: string; username: string; isAdmin: boolean };
export type LobbyCredentials = { playerId: string; token: string; revision: number };
// Push only a version number, never player credentials or future secret roles
export type LobbyChangedEvent = { revision: number };

// Public roster + the caller's identity; no other guest's token is ever returned.
export type LobbySnapshot = {
  roomId: typeof LOBBY_ROOM_ID;
  revision: number;
  adminPlayerId: string | null;
  players: LobbyPlayer[];
  you: LobbyPlayer;
};

// Keep HTTP error responses consistent between the server and browser client.
export type ApiError = { error: { code: string; message: string } };
