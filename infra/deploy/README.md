# Deploying PasteWorks

This is the simplest stack on the box. PasteWorks is a **static bundle that
runs entirely in the browser** — no API, no database, no sign-in. One nginx
container serves it, publishing to **`127.0.0.1:8460`** only; the server's
existing host nginx reverse-proxies `https://pasteworks.minesmart.cloud` to it
and terminates TLS through certbot. Same pattern as `assetpro` (8410-8413),
`pidpro` (8420-8422), `pipelinepro` (8430-8431), the portal (8440-8441) and
`processpro` (8450-8451).

```
  Browser --HTTPS--> host nginx (:443, certbot TLS)
                       |  server_name pasteworks.minesmart.cloud
                       |
                 127.0.0.1:8460
                       web
              (nginx static bundle :80)
```

**There is no identity here, on purpose.** No Keycloak client, no audience
scope, no group, nothing to provision in the `Identity` repo. Anyone with the
link can open it, which is the whole point of the thing. It holds no data,
writes nothing, and makes no outbound calls — every number on screen is
computed in the page. If that ever changes, it stops being a link you can hand
out and it needs the full `processpro` treatment instead.

## 1. Prerequisites

- Docker Engine and the Compose plugin, already present on this server.
- **DNS**: `pasteworks.minesmart.cloud` resolving to this server.
- The loopback port **8460** free.

## 2. Get the code

Every app on this server lives under `ben`, so clone alongside the others
(`/home/ben/assetpro`, `/home/ben/processpro`) rather than in your own home:

```bash
cd /home/ben
git clone https://github.com/Jacob12244/PasteWorks.git pasteworks
cd pasteworks/infra/deploy
```

There is nothing to configure — no `.env` is required. The only variable the
compose file reads is `IMAGE_TAG`, and it defaults to `latest`. Create a
one-line `.env` with `IMAGE_TAG=sha-<commit>` only when you want to pin or roll
back a specific build.

## 3. Start the container

Images are built off the server and pushed to the GitHub Container Registry by
`build-push.ps1` on a workstation. The server only pulls: on-server builds peg
this shared-CPU VPS hard enough to trip the host's abuse detection.

On a workstation, once per release:

```powershell
cd infra\deploy
.\build-push.ps1
```

One-time on the server, with a token carrying `read:packages`:

```bash
docker login ghcr.io -u Jacob12244
docker compose pull
docker compose up -d
docker compose ps
curl -sS http://127.0.0.1:8460/healthz     # -> ok
```

## 4. Publish it through the host nginx

```bash
sudo cp nginx/pasteworks.minesmart.cloud.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/pasteworks.minesmart.cloud.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pasteworks.minesmart.cloud
```

Certbot rewrites the single port 80 block into a TLS block plus a redirect,
keeping every location, which is how the other sites here are set up.

That is the whole deployment. Open `https://pasteworks.minesmart.cloud` and
send the link to anyone.

## Redeploying

```bash
cd /home/ben/pasteworks/infra/deploy && ./redeploy.sh
```

The path is absolute on purpose: the checkout belongs to `ben`, so `~` only
finds it when you are logged in as `ben`. Signed in as anyone else, run it with
`sudo -u ben ./redeploy.sh`. First time, make it executable with
`chmod +x redeploy.sh`.

`./redeploy.sh --no-pull` skips the image pull for a compose or config change.
`./redeploy.sh --build` builds on the server, which is an emergency fallback
only.

To roll back, put `IMAGE_TAG=sha-<commit>` in `.env` and redeploy. Every push
tags both `latest` and the commit it was built from.

## Backups

None. There is no stateful service — no database, no volume, no uploaded
files. The only thing worth keeping is the git history.

## A note on size

The bundle is ~860 kB (~230 kB gzipped), nearly all of it Three.js. It is one
file plus one HTML page, served with a year-long immutable cache on the hashed
asset and `no-cache` on `index.html`, so a return visit is a single small
request. Nothing is streamed and nothing is fetched at runtime, so it works
fine on a phone tether and behind a corporate proxy.
