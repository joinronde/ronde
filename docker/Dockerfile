# syntax=docker/dockerfile:1.7
# Ronde images, built from the monorepo root:
#   docker build -f docker/Dockerfile --target web -t ghcr.io/joinronde/ronde:web .
#   docker build -f docker/Dockerfile --target migrate -t ghcr.io/joinronde/ronde:migrate .
# The paid features stay off without a license; RONDE_PURE_CE=1 leaves their code out of the image entirely:
#   docker build -f docker/Dockerfile --target web --build-arg RONDE_PURE_CE=1 -t ghcr.io/joinronde/ronde:web-ce .

ARG NODE_IMAGE=node:22-alpine

############################
# Dependencies             #
############################
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages ./packages
COPY ee/package.json ee/package.json
COPY ee-stub/package.json ee-stub/package.json
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@ronde/web..."

############################
# Build (standalone)       #
############################
FROM deps AS build
WORKDIR /repo
# URL prefix baked at build time (Next.js basePath); empty = served at the root
ARG NEXT_PUBLIC_BASE_PATH=""
# 1: a pure Community build, without the code of the paid editions
ARG RONDE_PURE_CE=""
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH} \
    RONDE_PURE_CE=${RONDE_PURE_CE}
COPY . .
RUN pnpm --filter @ronde/db db:generate && pnpm --filter @ronde/web build

############################
# Migrations (run once)    #
############################
# Only @ronde/db and its runtime dependencies (the Prisma CLI among them): the schema and the migrations
FROM deps AS migrate-files
WORKDIR /repo
COPY packages/db ./packages/db
RUN pnpm --filter @ronde/db deploy --prod --legacy /migrate

FROM ${NODE_IMAGE} AS migrate
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/joinronde/ronde" \
      org.opencontainers.image.title="Ronde migrations" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version=${VERSION}
WORKDIR /app
ENV NODE_ENV=production
COPY --from=migrate-files --chown=node:node /migrate ./
USER node
CMD ["node", "scripts/migrate.mjs"]

############################
# Web application          #
############################
FROM ${NODE_IMAGE} AS web
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/joinronde/ronde" \
      org.opencontainers.image.title="Ronde" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version=${VERSION}
WORKDIR /app
# The version also names the release in error reports (SENTRY_DSN)
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    RONDE_VERSION=${VERSION}
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --chown=node:node docker/entrypoint.mjs ./apps/web/entrypoint.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/entrypoint.mjs"]
