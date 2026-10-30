# Build context: the repository root (pnpm workspace), e.g.
#   docker build -f services/backend/Dockerfile -t vectra-backend .
# One image, three processes selected by command: start:api | start:indexer | start:keeper.

FROM node:22.22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/sdk/package.json packages/sdk/
COPY services/backend/package.json services/backend/
RUN pnpm install --frozen-lockfile --filter @vectra/backend...

FROM deps AS build
COPY packages/sdk packages/sdk
COPY services/backend services/backend
RUN pnpm --filter @vectra/backend typecheck \
 && pnpm install --frozen-lockfile --prod --filter @vectra/backend...

FROM node:22.22-bookworm-slim AS runtime
ENV NODE_ENV=production NODE_NO_WARNINGS=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/services/backend
ENV DATABASE_PATH=/data/vectra.db
VOLUME ["/data"]
EXPOSE 8787
# Runs TypeScript via tsx (the shared SDK ships TS sources).
ENTRYPOINT ["node", "--import", "tsx"]
CMD ["src/cli/api.ts"]
