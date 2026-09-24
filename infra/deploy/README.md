# Deploying PasteWorks

This is the simplest stack on the box. PasteWorks is a **static bundle that
runs entirely in the browser**, plus **one small WebSocket server** for
Paste Wars — no API, no database, no sign-in. One nginx container serves the
bundle on **`127.0.0.1:8480`**, the arena runs on **`127.0.0.1:8481`**, and the
server's existing host nginx reverse-proxies `https://pasteworks.minesmart.cloud`
to them and terminates TLS through certbot. Same pattern as everything else
there. Each app owns a decade of loopback ports:

| Port      | App                                              |
| --------- | ------------------------------------------------ |
| 8410-8413 | `assetpro`                                       |
| 8420-8422 | `pidpro`                                         |
| 8430-8431 | `pipelinepro`                                    |
| 8440-8441 | the portal                                       |
| 8450-8451 | `processpro`                                     |
| 8460      | **Keycloak** — `Identity`, `id.minesmart.cloud`  |
| 8470-8471 | `bowtie`                                         |
| **8480-8481** | **`pasteworks`** — this one: `web`, `arena`  |

8460 looks like the next free slot and is not. Worse, it answers a health
probe with a plausible JSON error (`Unable to find matching target resource
method`, which is RESTEasy underneath Keycloak) rather than refusing the
connection, so a careless check reads as "something is up, near enough". Run
`sudo ss -ltnp | grep 84` and claim a port from what is actually bound, not
from the pattern.

```
  Browser --HTTPS/WSS--> host nginx (:443, certbot TLS)
                           |  server_name pasteworks.minesmart.cloud
                           |
               "/"         |          "/play", "/play/status"
          127.0.0.1:8480 --+-- 127.0.0.1:8481
               web                    arena
     (nginx static bundle :80)   (Node, WebSocket, a room per map)
```

**There is no identity here, on purpose.** No Keycloak client, no audience
scope, no group, nothing to provision in the `Identity` repo. Anyone with the
link can open it, which is the whole point of the thing. The page holds no
data, writes nothing, and makes no outbound calls — every number on screen is
computed in the page. The arena holds two games in memory - the plant and the
mine, up to fifteen in each - and nothing else: names are handed out rather
than typed, there is no chat, and a restart empties the rooms, which is all
there is to lose. If any of that ever
changes, it stops being a link you can hand out and it needs the full
`processpro` treatment instead.

## 1. Prerequisites

- Docker Engine and the Compose plugin, already present on this server.
- **DNS**: `pasteworks.minesmart.cloud` resolving to this server.
- The loopback ports **8480** and **8481** free.

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
back a specific build. The arena's limits (`ALLOWED_ORIGINS`, `PER_IP`,
`JOINS_PER_MIN`) are set in `docker-compose.yml` itself.

## 3. Start the containers

Images are built off the server and pushed to the GitHub Container Registry by
`build-push.ps1` on a workstation. The server only pulls: on-server builds peg
this shared-CPU VPS hard enough to trip the host's abuse detection.

On a workstation, once per release. Both images install the sizing game's
engine from GitHub Packages, so `NPM_TOKEN`, a token with `read:packages`, has
to be in the environment; `build-push.ps1` hands it to the build as a secret.

```powershell
cd infra\deploy
.\build-push.ps1              # both images; -Only web or -Only arena for one
```

One-time on the server, with a token carrying `read:packages`:

```bash
docker login ghcr.io -u Jacob12244
docker compose pull
docker compose up -d
docker compose ps
curl -sS http://127.0.0.1:8480/healthz       # -> ok
curl -sS http://127.0.0.1:8481/healthz       # -> ok
curl -sS http://127.0.0.1:8481/play/status   # -> {"online":0,"max":15,"rooms":{"plant":...,"mine":...}}
```

The arena container is read-only, capped at 256 MB and half a core. A full
room is a few MB and a few percent of a core; the caps are there so a bad
day for the arena is never a bad day for the box.

## 4. Publish them through the host nginx

```bash
sudo cp nginx/pasteworks.minesmart.cloud.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/pasteworks.minesmart.cloud.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pasteworks.minesmart.cloud
```

Certbot rewrites the single port 80 block into a TLS block plus a redirect,
keeping every location, which is how the other sites here are set up.

That is the whole deployment. Open `https://pasteworks.minesmart.cloud`, and
`https://pasteworks.minesmart.cloud/?arena` and `?arena=mine` for Paste Wars,
and send the link to anyone.

## Adding Paste Wars to a running server

Both maps go through the same `/play` location - the mine is `/play?map=mine`,
and nginx passes the query string through - so the step below is the only
one, whichever maps the arena serves.

A server set up before Paste Wars needs one hand step, because certbot has
since rewritten the live vhost and copying the repo's file over it would drop
the TLS block.

1. `./redeploy.sh` as usual. It pulls both images and brings the new `arena`
   container up on 8481 on its own.
2. Edit the live file, `/etc/nginx/sites-available/pasteworks.minesmart.cloud.conf`:
   put the `map` at the top, outside any `server` block, and the two `/play`
   locations inside the **443** `server` block, next to `location /`. All three
   are in [nginx/pasteworks.minesmart.cloud.conf](nginx/pasteworks.minesmart.cloud.conf):

   ```nginx
   map $http_upgrade $pasteworks_upgrade {
       default upgrade;
       ''      close;
   }

   location = /play {
       proxy_pass http://127.0.0.1:8481;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection $pasteworks_upgrade;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_read_timeout 1h;
       proxy_send_timeout 1h;
   }

   location = /play/status {
       proxy_pass http://127.0.0.1:8481;
       proxy_set_header X-Real-IP $remote_addr;
   }
   ```

3. `sudo nginx -t && sudo systemctl reload nginx`, then
   `curl -sS https://pasteworks.minesmart.cloud/play/status`.

Until step 2 is done, `/?arena` still works — the page finds no server and
says so, and runs a practice room of its own in the browser.

`X-Real-IP` matters: behind the proxy every socket arrives from loopback, and
the arena's per-address limits read the real address from that header. It is
only believed from loopback or the Docker bridge.

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

A redeploy restarts the arena, which empties the rooms. Anyone playing sees
*Lost the line - reconnecting* and is back in a few seconds under a new name.
When a redeploy changes the wire protocol, a page loaded before it is told to
reload instead.

To roll back, put `IMAGE_TAG=sha-<commit>` in `.env` and redeploy. Every push
tags both images with `latest` and the commit they were built from.

## Backups

None. There is no stateful service — no database, no volume, no uploaded
files, and the arena's games live and die in memory. The only thing worth
keeping is the git history.

## A note on size

The bundle is about 1 MB (about 290 kB gzipped), nearly all of it Three.js,
plus a 108 kB arena chunk (42 kB gzipped) that only loads for `?arena`. Everything is served
with a year-long immutable cache on the hashed assets and `no-cache` on
`index.html`, so a return visit is a single small request. The main page
fetches nothing at runtime, so it works fine on a phone tether and behind a
corporate proxy; Paste Wars needs a WebSocket, which some corporate proxies
will not pass.

The arena image is about 140 MB: Node on Alpine, one bundled file, and the
two baked collision worlds, 1.5 MB between them. Running, it holds both in
well under 100 MB.
