# Build context is the monorepo root (see docker-compose.yml) - see the note in
# artifacts/api-server/Dockerfile; the frontend depends on the generated
# @workspace/api-client-react package under lib/.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY lib ./lib
COPY scripts ./scripts
COPY artifacts/cloudnest ./artifacts/cloudnest
RUN pnpm install --frozen-lockfile
WORKDIR /app/artifacts/cloudnest
EXPOSE 5173
CMD ["pnpm", "run", "dev"]
