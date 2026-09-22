# Build the PasteWorks production image locally and push it to the GitHub
# Container Registry. The server never builds; it runs ./redeploy.sh, which
# pulls.
#
#   .\build-push.ps1      build web, push :latest and :sha-<git sha>
#
# One-time setup: a classic GitHub token with write:packages and read:packages,
# then "docker login ghcr.io -u Jacob12244". Unlike ProcessPro there is no
# private npm package here, so no NPM_TOKEN is needed.

$ErrorActionPreference = 'Stop'

$registry = 'ghcr.io/jacob12244'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$sha = (git -C $repoRoot rev-parse --short HEAD).Trim()
$shaTag = "sha-$sha"

# Warn but do not block: the sha tag only names committed code.
$dirty = git -C $repoRoot status --porcelain
if ($dirty) { Write-Warning "Working tree has uncommitted changes - the :$shaTag tag will not match the image contents exactly." }

$image = "$registry/pasteworks-web"
Write-Host "==> building $image ($shaTag)" -ForegroundColor Cyan
& docker build -f (Join-Path $PSScriptRoot 'web\Dockerfile') `
    -t "${image}:latest" -t "${image}:$shaTag" "$repoRoot"
if ($LASTEXITCODE -ne 0) { throw 'docker build failed' }

Write-Host "==> pushing $image" -ForegroundColor Cyan
& docker push "${image}:latest"
if ($LASTEXITCODE -ne 0) { throw "docker push failed (did you 'docker login ghcr.io'?)" }
& docker push "${image}:$shaTag"
if ($LASTEXITCODE -ne 0) { throw 'docker push failed' }

Write-Host ""
# The checkout on the server belongs to ben, so ~ only finds it when you are logged in as ben.
Write-Host "Done. On the server:  cd /home/ben/pasteworks/infra/deploy && ./redeploy.sh" -ForegroundColor Green
Write-Host "Rollback: set IMAGE_TAG=$shaTag in the server's .env and rerun redeploy.sh with a previous sha."
