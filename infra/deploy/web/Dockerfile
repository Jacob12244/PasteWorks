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
# The Filter plant's model is kept out of git (public/local), so a checkout
# that has it ships it and one that does not builds without it - and without
# the map, whose door only opens when the model is there. It is already
# meshopt-compressed and gzip still takes a third off, so nginx gets it both ways.
RUN --mount=type=bind,target=/ctx if [ -d /ctx/public ]; then cp -r /ctx/public public; fi
RUN npm run build && if [ -d dist/local ]; then gzip -9 -k dist/local/*.glb; fi

FROM nginx:1.27-alpine AS runtime
COPY infra/deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
