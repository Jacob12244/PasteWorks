# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (see docker-compose.yml: build.context: ../..).
#
# PasteWorks is a single Vite app with no workspace and no build-time
# configuration - it talks to nothing, so there is nothing to inject. Its one
# private package is the sizing game's solver, ProcessPro's engine, from GitHub
# Packages.

FROM node:20-alpine AS build
WORKDIR /app

# Dependencies first, cached on the lock file alone. The registry token arrives
# as a build secret in the environment, which is what the repo .npmrc expands,
# so it never lands in an image layer:
#   docker build --secret id=npm_token,env=NPM_TOKEN
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src/ src/
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY infra/deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
