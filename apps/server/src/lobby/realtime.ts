import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { ZodError } from "zod";
import {
  EVENTS, joinLobbySchema,
  type ClientToServerEvents, type ServerToClientEvents,
  type InterServerEvents, type SocketData,
} from "@ft/contracts";
import { LobbyError } from "./errors.js";
import type { LobbyService } from "./service.js";

export const LOBBY_SOCKET_ROOM = "werewolf:lobby";
type LobbyIo = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

//Socket.IO carries only revision notices, never secret roles or votes.
//Pick typescript 
export function createLobbySocketServer(httpServer: HttpServer, service: Pick<LobbyService, "authenticate">): LobbyIo {
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

  //two nested callbacks
  //socket is client's Socket object in the callback (=>) (called a closure)
  io.on("connection", (socket) => {
    // Merely connecting does not grant access to protected lobby broadcasts
    socket.on(EVENTS.LOBBY_JOIN, async (input, acknowledge) => {
      try {
        const { token } = joinLobbySchema.parse(input);
        // Resolve the token against PostgreSQL before granting room membership.
        const player = await service.authenticate(token);
        await socket.leave(LOBBY_SOCKET_ROOM);
        socket.data.lobbyPlayerId = player.id;
        await socket.join(LOBBY_SOCKET_ROOM);
        if (typeof acknowledge === "function") acknowledge({ ok: true, data: { playerId: player.id } });
      } catch (error) {
        delete socket.data.lobbyPlayerId;
        await socket.leave(LOBBY_SOCKET_ROOM);
        if (typeof acknowledge !== "function") return;
        if (error instanceof LobbyError) {
          acknowledge({ ok: false, error: { code: error.code, message: error.message } });
        } else if (error instanceof ZodError) {
          acknowledge({ ok: false, error: { code: "INVALID_INPUT", message: "Invalid lobby join" } });
        } else {
          console.error("Lobby join failed", error);
          acknowledge({ ok: false, error: { code: "INTERNAL_ERROR", message: "Lobby unavailable" } });
        }
      }
    });
  });
  return io;
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
