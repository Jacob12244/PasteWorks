# Build the PasteWorks production images locally and push them to the GitHub
# Container Registry. The server never builds; it runs ./redeploy.sh, which
# pulls.
#
#   .\build-push.ps1              build web and arena, push :latest and :sha-<git sha>
#   .\build-push.ps1 -Only arena  just one of them
#
# One-time setup: a classic GitHub token with write:packages and read:packages,
# then "docker login ghcr.io -u Jacob12244". Unlike ProcessPro there is no
# private npm package here, so no NPM_TOKEN is needed.
param([ValidateSet('web', 'arena')][string]$Only)

$ErrorActionPreference = 'Stop'

$registry = 'ghcr.io/jacob12244'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$sha = (git -C $repoRoot rev-parse --short HEAD).Trim()
$shaTag = "sha-$sha"

# Warn but do not block: the sha tag only names committed code.
$dirty = git -C $repoRoot status --porcelain
if ($dirty) { Write-Warning "Working tree has uncommitted changes - the :$shaTag tag will not match the image contents exactly." }

$targets = if ($Only) { @($Only) } else { @('web', 'arena') }
foreach ($name in $targets) {
    $image = "$registry/pasteworks-$name"
    Write-Host "==> building $image ($shaTag)" -ForegroundColor Cyan
    & docker build -f (Join-Path $PSScriptRoot "$name\Dockerfile") `
        -t "${image}:latest" -t "${image}:$shaTag" "$repoRoot"
    if ($LASTEXITCODE -ne 0) { throw "docker build failed ($name)" }

    Write-Host "==> pushing $image" -ForegroundColor Cyan
    & docker push "${image}:latest"
    if ($LASTEXITCODE -ne 0) { throw "docker push failed (did you 'docker login ghcr.io'?)" }
    & docker push "${image}:$shaTag"
    if ($LASTEXITCODE -ne 0) { throw 'docker push failed' }
}

Write-Host ""
# The checkout on the server belongs to ben, so ~ only finds it when you are logged in as ben.
Write-Host "Done. On the server:  cd /home/ben/pasteworks/infra/deploy && ./redeploy.sh" -ForegroundColor Green
Write-Host "Rollback: set IMAGE_TAG=$shaTag in the server's .env and rerun redeploy.sh with a previous sha."
