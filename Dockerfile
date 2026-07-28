# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /workspace
COPY . .

RUN --mount=type=cache,id=intero-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile \
      --filter . \
      --filter @intero/server-api... \
      --filter @intero/server-worker... \
      --filter @intero/web...

RUN pnpm turbo run build \
      --filter=@intero/server-api \
      --filter=@intero/server-worker \
      --filter=@intero/web

RUN --mount=type=cache,id=intero-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm --filter @intero/server-api deploy --prod --legacy /opt/intero/api && \
    pnpm --filter @intero/server-worker deploy --prod --legacy /opt/intero/worker

FROM node:24-alpine AS api

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /opt/intero/api/ ./
USER node
EXPOSE 4310
CMD ["node", "dist/index.js"]

FROM node:24-alpine AS worker

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /opt/intero/worker/ ./
USER node
EXPOSE 9464
CMD ["node", "dist/index.js"]

# Migrations deliberately retain the full build workspace: migrate:all uses the
# checked-in Drizzle journal and SpiceDB schema in addition to Graphile Worker.
FROM build AS migrator

ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@intero/server-worker", "migrate:all"]

FROM caddy:2.11.4-alpine AS gateway

COPY --from=build /workspace/apps/web/dist/ /srv/
COPY infra/caddy/Caddyfile.production /etc/caddy/Caddyfile
EXPOSE 4311
