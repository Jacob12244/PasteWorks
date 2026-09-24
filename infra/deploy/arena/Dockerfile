# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (see docker-compose.yml: build.context: ../..).
#
# The Paste Wars server: one Node process, a room for each map, fifteen
# slots each. The collision worlds they play against are baked into the repo
# (server/worlds, by tools/bake.mjs), so the image needs no browser and
# nothing at runtime but Node and one bundled file.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
COPY server/ server/
RUN npm run arena:build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8481
COPY --from=build /app/server/dist/arena.cjs ./arena.cjs
COPY server/worlds/ ./worlds/
USER node
EXPOSE 8481
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8481/healthz || exit 1
CMD ["node", "arena.cjs"]
