#!/usr/bin/env bash
# Pull the latest code and image, then restart the PasteWorks container.
#
#   ./redeploy.sh              git pull, compose pull web, restart, health check
#   ./redeploy.sh --no-pull    skip the image pull (compose or config changes only)
#   ./redeploy.sh --build      build on the server (emergency only: image builds peg
#                              this shared-CPU VPS; normally build-push.ps1 pushes
#                              from a workstation and this script just pulls)
#
# There is no database and no state, so there is nothing to migrate and nothing
# to back up. This does not touch the host nginx vhost or TLS.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

MODE=pull
case "${1:-}" in
  --no-pull) MODE=none ;;
  --build)   MODE=build ;;
esac

echo "==> git pull"
git pull --ff-only

if [[ $MODE == pull ]]; then
  echo "==> docker compose pull web"
  docker compose pull web
elif [[ $MODE == build ]]; then
  echo "==> docker compose build web   (on-server build: expect heavy CPU)"
  docker compose build web
fi

echo "==> docker compose up -d --remove-orphans"
docker compose up -d --remove-orphans

echo "==> waiting for web (127.0.0.1:8480/healthz)"
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8480/healthz >/dev/null 2>&1; then
    echo "    web healthy"
    break
  fi
  sleep 2
  [[ $i -eq 15 ]] && echo "    web still not answering after 30s - check: docker compose logs --tail=50 web" >&2
done

echo "==> status"
docker compose ps

echo
echo "Done. Live at https://pasteworks.minesmart.cloud"
echo "Logs:  docker compose logs -f web"
