import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { registerLobbySchema, kickPlayerSchema, type ApiError, type HealthResponse } from "@ft/contracts";
import type { MatchService } from "./game/types.js";
import { LobbyError } from "./lobby/errors.js";
import type { LobbyService } from "./lobby/service.js";

// Express doesn't import socket.io directly, its caller injects notif functions
// 
export type LobbyNotifications = {
  changed(revision: number): void;
  kicked(playerId: string): void;
};

// Stable error format so the browser can display friendly messages.
function apiError(code: string, message: string): ApiError {
  return { error: { code, message } };
}

// All private lobby requests authenticate using the token returned at registration.
function bearerToken(header: string | undefined): string {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(header ?? "")?.[1];
  if (!token) throw new LobbyError("UNAUTHORIZED", "Missing or invalid guest token", 401);
  return token;
}

// Express only validates HTTP input and output.
export function createApp(lobby: LobbyService, notify: LobbyNotifications, matches: MatchService) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  // Start and kick must not interleave across database awaits: a kick could
  // otherwise remove a guest from a newly frozen match roster.
  let rosterOperation: Promise<unknown> = Promise.resolve();
  function serializeRoster<T>(work: () => Promise<T>): Promise<T> {
    const result = rosterOperation.then(work);
    rosterOperation = result.catch(() => {});
    return result;
  }

  function changed(revision: number): void {
    try { notify.changed(revision); }
    catch (error) { console.error("Lobby notification failed", error); }
  }

  app.get("/api/health", (_request, response) => {
    const health: HealthResponse = { status: "ok", service: "skyjo-server" };
    response.json(health);
  });

  app.post("/api/lobby/register", async (request, response) => {
    const { username } = registerLobbySchema.parse(request.body);
    const credentials = await lobby.register(username);
    response.set("Cache-Control", "no-store").status(201).json(credentials);
    changed(credentials.revision);
  });

  app.get("/api/lobby/state", async (request, response) => {
    const snapshot = await lobby.getState(bearerToken(request.header("Authorization")));
    response.set("Cache-Control", "no-store").json(snapshot);
  });

  app.post("/api/lobby/start", (request, response) => serializeRoster(async () => {
    const state = await lobby.getState(bearerToken(request.header("Authorization")));
    if (!state.you.isAdmin) throw new LobbyError("FORBIDDEN", "Only the admin can start the match.", 403);
    const seats = state.players.map(({ id, username }) => ({ playerId: id, username }));
    const result = await matches.startMatch({ roomId: state.roomId, seats });
    response.set("Cache-Control", "no-store").json(result);
  }));

  app.post("/api/lobby/kick", (request, response) => serializeRoster(async () => {
    const token = bearerToken(request.header("Authorization"));
    const { playerId } = kickPlayerSchema.parse(request.body);
    const caller = await lobby.getState(token);
    if (!caller.you.isAdmin) throw new LobbyError("FORBIDDEN", "Only the admin can kick players.", 403);
    if (matches.activeMatch) {
      const match = matches.activeMatch.snapshotFor("");
      if (match.public.phase.kind !== "match-end" && match.public.seats.some(seat => seat.playerId === playerId)) {
        throw new LobbyError("MATCH_IN_PROGRESS", "Cannot kick a seated player during a match.", 409);
      }
    }
    const result = await lobby.kick(token, playerId);
    response.set("Cache-Control", "no-store").json(result);

    try { notify.kicked(result.playerId); }
    catch (error) { console.error("Kick notification failed", error); }
    changed(result.revision);
  }));

  app.use((_request, response) => {
    response.status(404).json(apiError("NOT_FOUND", "Route not found"));
  });

  // Express 5 forwards errors thrown by async route handlers to this middleware.
  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof LobbyError) {
      response.status(error.status).json(apiError(error.code, error.message));
    } else if (error instanceof ZodError) {
      response.status(400).json(apiError("INVALID_INPUT", "Invalid request data"));
    } else if ((error as { type?: string } | null)?.type === "entity.too.large") {
      response.status(413).json(apiError("PAYLOAD_TOO_LARGE", "Request body exceeds limit"));
    } else if ((error as { type?: string } | null)?.type === "entity.parse.failed") {
      response.status(400).json(apiError("INVALID_JSON", "Malformed JSON body"));
    } else {
      console.error("Unhandled request error", error);
      response.status(500).json(apiError("INTERNAL_ERROR", "Internal server error"));
    }
  };
  app.use(errorHandler);
  return app;
}
