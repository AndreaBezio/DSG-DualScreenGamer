# One image for api/worker/migrate (target "server") and one for the site (target "web").

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/schema/package.json packages/schema/
COPY packages/romdb/package.json packages/romdb/
RUN pnpm install --frozen-lockfile

# Server image skips the site's dependencies (Next/React)
FROM base AS server
RUN apk add --no-cache git && mkdir -p /data/uploads /data/registry-repo && chown -R node:node /data
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/schema/package.json packages/schema/
COPY packages/romdb/package.json packages/romdb/
RUN pnpm install --frozen-lockfile --filter dsg --filter "@dsg/api..." --filter "@dsg/worker..." && pnpm store prune
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY registry registry
ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]

FROM deps AS web-build
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @dsg/web build

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
