import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { ZodError } from "zod";
import {
  EVENTS, gameCommandSchema, gameSubscribeSchema, joinLobbySchema,
  type ClientToServerEvents, type ServerToClientEvents,
  type InterServerEvents, type SocketData,
} from "@ft/contracts";
import type { ActiveMatch, MatchService } from "../game/types.js";
import { LobbyError } from "./errors.js";
import type { LobbyService } from "./service.js";

export const LOBBY_SOCKET_ROOM = "skyjo:lobby";
type LobbyIo = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function createLobbySocketServer(
  httpServer: HttpServer,
  service: Pick<LobbyService, "authenticate">,
  matches: Pick<MatchService, "activeMatch">,
): LobbyIo {
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001")
      .split(",").map((origin) => origin.trim()).filter(Boolean),
  );
  //create socket.io server attached to httpServer
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    path: "/socket.io",
    maxHttpBufferSize: 4 * 1024,
    cors: { origin: false },
    // Prototype bound to localhost. Only local browser origins can connect.
    allowRequest(request, accept) {
      const origin = request.headers.origin;
      if (!origin) return accept(null, true);
      try {
        const url = new URL(origin);
        // Both the Vite origin and the direct Express port are allowed locally.
        accept(null, allowedOrigins.has(url.origin));
      } catch {
        accept("Invalid Origin", false);
      }
    },
  });

  // Get the parameter types from our shared event contract (since no anonymous function)
  type JoinArgs = Parameters<ClientToServerEvents[typeof EVENTS.LOBBY_JOIN]>;
  //socket is client's Socket object in the callback (=>) (called a closure)
  io.on("connection", (socket) => {
    // Handles a player's request to join the lobby
    async function handleLobbyJoin(
      input: JoinArgs[0],
      acknowledge: JoinArgs[1]
    ): Promise<void> {
      try {
        const { token } = joinLobbySchema.parse(input);
		// Resolve the token against PostgreSQL before granting room membership.
        const player = await service.authenticate(token);
        await socket.leave(LOBBY_SOCKET_ROOM);
        socket.data.lobbyPlayerId = player.id;
        await socket.join(LOBBY_SOCKET_ROOM);
        if (typeof acknowledge === "function") {
          acknowledge({
            ok: true,
            data: { playerId: player.id, activeMatchId: matches.activeMatch?.matchId ?? null },
          });
        }
      } catch (error) {
        delete socket.data.lobbyPlayerId;
        await socket.leave(LOBBY_SOCKET_ROOM);
        if (typeof acknowledge !== "function")
			return;
        if (error instanceof LobbyError) {
          acknowledge({
            ok: false,
            error: { code: error.code, message: error.message }
          });
        } else if (error instanceof ZodError) {
          acknowledge({	
            ok: false,
            error: { code: "INVALID_INPUT", message: "Invalid lobby join" }
          });
        } else {
          console.error("Lobby join failed", error);
          acknowledge({
            ok: false,
            error: { code: "INTERNAL_ERROR", message: "Lobby unavailable" }
          });
        }
      }
    }
    // Register named function as the event handler
    socket.on(EVENTS.LOBBY_JOIN, handleLobbyJoin);
    socket.on(EVENTS.GAME_COMMAND, (input, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      const playerId = socket.data.lobbyPlayerId;
      if (!playerId || !socket.rooms.has(LOBBY_SOCKET_ROOM)) {
        return acknowledge({ ok: false, error: { code: "UNAUTHORIZED", message: "Join the lobby first." } });
      }
      const request = gameCommandSchema.safeParse(input);
      if (!request.success) return acknowledge({ ok: false, error: { code: "INVALID_INPUT", message: "Invalid command." } });
      const match = matches.activeMatch;
      if (!match || match.matchId !== request.data.matchId) return acknowledge({ ok: false, error: { code: "MATCH_NOT_FOUND", message: "Match unavailable." } });
      try {
        const revision = match.command(playerId, request.data.expectedRevision, request.data.command);
        broadcastMatchSnapshot(io, match);
        acknowledge({ ok: true, data: { revision } });
      } catch (error) {
        if (error instanceof LobbyError) {
          socket.emit(EVENTS.GAME_SNAPSHOT, match.snapshotFor(playerId));
          acknowledge({ ok: false, error: { code: error.code, message: error.message } });
        } else {
          console.error("Game command failed", error);
          acknowledge({ ok: false, error: { code: "INTERNAL_ERROR", message: "Game command failed." } });
        }
      }
    });
    socket.on(EVENTS.GAME_SUBSCRIBE, (input, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      const playerId = socket.data.lobbyPlayerId;
      if (!playerId || !socket.rooms.has(LOBBY_SOCKET_ROOM)) {
        return acknowledge({ ok: false, error: { code: "UNAUTHORIZED", message: "Join the lobby first." } });
      }
      const request = gameSubscribeSchema.safeParse(input);
      if (!request.success) {
        return acknowledge({ ok: false, error: { code: "INVALID_INPUT", message: "Invalid match subscription." } });
      }
      const match = matches.activeMatch;
      if (!match || match.matchId !== request.data.matchId) {
        return acknowledge({ ok: false, error: { code: "MATCH_NOT_FOUND", message: "This match is unavailable." } });
      }
      acknowledge({ ok: true, data: match.snapshotFor(playerId) });
    });
  });

  return io;
}

export function broadcastMatchSnapshot(io: LobbyIo, match: ActiveMatch): void {
  for (const socket of io.sockets.sockets.values()) {
    const playerId = socket.data.lobbyPlayerId;
    if (playerId && socket.rooms.has(LOBBY_SOCKET_ROOM)) {
      socket.emit(EVENTS.GAME_SNAPSHOT, match.snapshotFor(playerId));
    }
  }
}

/** Revoke sockets after the database commits a kick. */
export function notifyKickedPlayer(io: LobbyIo, playerId: string): void {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.lobbyPlayerId !== playerId) continue;
    delete socket.data.lobbyPlayerId;
    socket.emit(EVENTS.LOBBY_KICKED);
    void socket.leave(LOBBY_SOCKET_ROOM);
  }
}
