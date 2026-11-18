# Multi-target image for the pnpm monorepo. Build with: docker build -f infrastructure/docker/node.Dockerfile --target api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN NODE_ENV=production pnpm --filter @atlas/web build && NODE_ENV=production pnpm --filter @atlas/admin build

# API runs TypeScript directly through tsx (workspace packages export .ts sources).
FROM deps AS api
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
CMD ["npx", "tsx", "src/main.ts"]

FROM build AS web
ENV NODE_ENV=production
WORKDIR /repo/apps/web
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]

FROM build AS admin
ENV NODE_ENV=production
WORKDIR /repo/apps/admin
USER node
EXPOSE 3001
CMD ["npx", "next", "start", "-p", "3001"]
