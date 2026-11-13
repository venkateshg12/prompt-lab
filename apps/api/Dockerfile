# syntax=docker/dockerfile:1.7
# ADAPT of @pt-api/Dockerfile: builds @repo/scoring too; no poppler-utils; ships prisma/ + prisma.config.ts.
# One image, two commands: the API (default CMD, migrates first) and the worker (`node dist/worker.js`, never migrates).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/types/package.json packages/types/
COPY packages/scoring/package.json packages/scoring/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile

FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile \
 && pnpm --filter @repo/types build \
 && pnpm --filter @repo/scoring build \
 && pnpm --filter api build \
 && pnpm deploy --filter api --prod /out \
 && cp -r apps/api/prisma apps/api/prisma.config.ts /out/

FROM node:22-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 5000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Migrations go through Neon's DIRECT url when set (the pooled one can't hold migrate's advisory lock);
# the app itself keeps the pooled DATABASE_URL.
CMD ["sh", "-c", "DATABASE_URL=\"${DIRECT_DATABASE_URL:-$DATABASE_URL}\" npx --no-install prisma migrate deploy && exec node dist/index.js"]
