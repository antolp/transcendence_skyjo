# Skyjo

Multiplayer guest lobby and server-authoritative Skyjo for 2–8 players. Node.js + Express, Socket.IO, React,  Zod contracts, PostgreSQL/Prisma lobby, and Docker deploymenT

- [Rules](docs/skyjo-rules.md)

## First-time setup

```bash
cp .env.example .env
# Edit .env : set POSTGRES_PASSWORD
docker compose up --build -d
```
Open http://localhost:8080. `docker compose down` to shut down the app.


### Play a game

1. Open the URL in two to eight separate browser profiles or devices, and register a different username in each  (ordinary tabs share the same token, so same player)
2. First registered guest is the admin. Click **Start match**. (if old guest registrations are present, kick them before starting).
3. Each player reveals any two own cards, server selects the first turn.
4. On your turn, choose a pile, then click an occupied own slot to swap. If drawing from the deck, you can instead discard and reveal a hidden slot. Matching columns disappear automatically.
5. After the finisher and the other players' last turns, inspect scores and click **Next round** if the match is not over. Play until a win. The admin can start another match after the previous one finishes.

### Host-side dev (vite)

The Vite development server is localhost-only.
Same thing with `POSTGRES_PASSWORD`, except the password placeholder must also be replaced in `DATABASE_URL`. 
```
npm ci
npm run db:setup
npm run dev
```
db:up script also publish PostgreSQL, see docker-compose.dev.yml

### commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend and backend |
| `npm run build` | Build contracts, generated Prisma client, server, and frontend |
| `npm run typecheck` | Type-check server and frontend |
| `npm run db:up` | Start PostgreSQL and wait for its health check |
| `npm run db:down` | Stop the database without deleting its data |
| `npm run db:generate` | Generate the TypeScript Prisma client |
| `npm run db:migrate` | Apply committed migrations |
| `npm run db:seed` | Ensure the single `demo` lobby exists |

explore prisma :
`npm exec -w @ft/server -- prisma studio`

When changing the Prisma schema, create a migration with `npm exec -w @ft/server -- prisma migrate dev --name <name>` and commit it. Do not run `docker compose down -v` unless you want to delete the entire database.

### project files/directories

```text
apps/web/                 React frontend and HTTP lobby client
apps/server/src/app.ts    Express API endpoints and error handling
apps/server/src/lobby/    Database tracked registration, lobby and game socket transport
apps/server/src/game/     Authoritative in-memory Skyjo engine
apps/server/test/         Engine and HTTP/socket integration tests
doc/                      Rules and other stuff
apps/server/prisma/       Prisma schema, clean migration, idempotent  seed
packages/contracts/       Shared TypeScript types and Zod request schemas
```
## current state

One persistant lobby (`demo`) in DB, one live match in memory, HTTP only. Guest registrations survive a server restart, the active match does not. Disconnected seated players must return, no timers forfeits or forced substitutions. Multiple lobbies, account management next

## Socket.IO

The browser connects to /socket.io on the same origin as the page
Nginx forwards HTTP polling and WebSocket upgrades to server:3001
Vite provides the equivalent proxy for development and only builds static files for production

The socket joins the lobby after the server checks its guest token
Registration and kicks broadcast a revision notice, then the browser fetches the lobby roster through the authenticated HTTP API
After reconnecting, the browser joins again and fetches the current roster and the viewer-specific match snapshot. Commands carry the expected revision; successful commands broadcast individualized snapshots, never raw private state.

ALLOWED_ORIGINS in .env is a comma-separated list of allowed browser origins for socket.io server (makes Vite work)
Use the exact scheme, hostname and port of the frontend.

### misc

to fix VSCode error linter :
```
npm ci
npm run build:contracts
npm run db:generate
```