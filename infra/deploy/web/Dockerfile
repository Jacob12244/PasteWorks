# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (see docker-compose.yml: build.context: ../..).
#
# PasteWorks is a single Vite app with no workspace, no private packages and no
# build-time configuration - it talks to nothing, so there is nothing to inject.

FROM node:20-alpine AS build
WORKDIR /app

# Dependencies first, cached on the lock file alone.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src/ src/
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY infra/deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
