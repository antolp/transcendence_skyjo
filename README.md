now with registration (no account no password but the groundwork is here) and ORM 

next : final contracts, then actual server-side game loop and lobby

## First-time setup

Set `POSTGRES_PASSWORD` in .env and then :
```bash
cp .env.example .env
docker compose up --build -d
```
Open http://localhost:8080. `docker compose down` to shut down the app.


### Host-side dev

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
apps/server/src/lobby/    Database tracked registration and lobby snapshots
apps/server/prisma/       Prisma schema, clean migration, idempotent  seed
packages/contracts/       Shared TypeScript types and Zod request schemas
```
# TO-DO (short-term)
- the app is HTTP-only and binds to localhost for now
- multiple lobbies, option to leave and other stuff
- full contract for game.state

## Socket.IO

The browser connects to /socket.io on the same origin as the page
Nginx forwards HTTP polling and WebSocket upgrades to server:3001
Vite provides the equivalent proxy for development and only builds static files for production

The socket joins the lobby after the server checks its guest token
Registration and kicks broadcast a revision notice, then the browser fetches the lobby roster through the authenticated HTTP API
After reconnecting, the browser joins again and fetches the current roster

ALLOWED_ORIGINS in .env is a comma-separated list of allowed browser origins for socket.io server (makes Vite work)
Use the exact scheme, hostname and port of the frontend 