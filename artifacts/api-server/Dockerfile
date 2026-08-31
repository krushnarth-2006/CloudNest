# Build context is the monorepo root (see docker-compose.yml) because this is a
# pnpm workspace: the api-server depends on the @workspace/api-zod and
# @workspace/db packages under lib/, which pnpm needs alongside it to resolve
# workspace links. Building from this subfolder alone would fail to install.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY lib ./lib
COPY scripts ./scripts
COPY artifacts/api-server ./artifacts/api-server
RUN pnpm install --frozen-lockfile
WORKDIR /app/artifacts/api-server
EXPOSE 5000
CMD ["pnpm", "run", "dev"]
