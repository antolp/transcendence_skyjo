# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS build
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/server apps/server
COPY apps/web apps/web
# Generation needs a URL, but never connects to a database during the build.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build

FROM base AS server
ENV NODE_ENV=production SERVER_HOST=0.0.0.0 SERVER_PORT=3001
# Keep Prisma CLI and tsx for migration/seed at startup.
COPY --from=build --chown=node:node /app /app
COPY --chmod=755 docker/server-entrypoint.sh /usr/local/bin/server-entrypoint
USER node
EXPOSE 3001
ENTRYPOINT ["server-entrypoint"]
CMD ["node", "apps/server/dist/index.js"]

FROM nginx:stable-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
