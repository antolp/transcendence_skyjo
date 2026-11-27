import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { z } from "zod";
import { EVENTS } from "@ft/contracts";
import { createApp } from "./app.js";
import { createMatchService } from "./game/match.js";
import { createLobbyService } from "./lobby/service.js";
import { createLobbySocketServer, LOBBY_SOCKET_ROOM, notifyKickedPlayer, broadcastMatchSnapshot } from "./lobby/realtime.js";

// Both src/index.ts and dist/index.js live three directories below the project root.
dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const environment = z.object({
  SERVER_HOST: z.string().min(1).default("127.0.0.1"),
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z.string().url(),
}).safeParse(process.env);
if (!environment.success) {
  console.error("Invalid server configuration:", environment.error.flatten().fieldErrors);
  process.exit(1);
}

const { SERVER_HOST: host, SERVER_PORT: port } = environment.data;
const prisma = new PrismaClient();
try {
  await prisma.$connect();
} catch (error) {
  console.error("Cannot connect to PostgreSQL. Run npm run db:setup first.", error);
  await prisma.$disconnect();
  process.exit(1);
}

//TS infers the type of lobby and matches automatically
const lobby = createLobbyService(prisma);
const matches = createMatchService((match) => broadcastMatchSnapshot(io, match));
// Express handles HTTP API requests. socket.io attaches to the SAME HTTP server (see realtime.ts)
// The callbacks don't fire until a request finishes its database transaction.
const httpServer = createServer(createApp(lobby, {
  changed: (revision) => io.to(LOBBY_SOCKET_ROOM).emit(EVENTS.LOBBY_CHANGED, { revision }),
  kicked: (playerId) => notifyKickedPlayer(io, playerId),
}, matches));
// The socket server uses the lobby's auth method before joining the event room.
const io = createLobbySocketServer(httpServer, lobby, matches);
httpServer.listen(port, host, () => {
  console.info(`skyjo listening on http://${host}:${port}`);
});

// A single close routine prevents overlapping shutdowns from SIGINT/SIGTERM.
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    io.close(async () => {
      await prisma.$disconnect();
      process.exit();
    });
  });
}
