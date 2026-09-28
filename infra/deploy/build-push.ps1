# Build the PasteWorks production images locally and push them to the GitHub
# Container Registry. The server never builds; it runs ./redeploy.sh, which
# pulls.
#
#   .\build-push.ps1              build web and arena, push :latest and :sha-<git sha>
#   .\build-push.ps1 -Only arena  just one of them
#
# One-time setup: a classic GitHub token with write:packages and read:packages,
# then "docker login ghcr.io -u Jacob12244". Both builds also install the sizing
# game's engine from GitHub Packages, so NPM_TOKEN (a token with read:packages)
# has to be in your environment; it goes in as a build secret.
param([ValidateSet('web', 'arena')][string]$Only)

$ErrorActionPreference = 'Stop'

if (-not $env:NPM_TOKEN) {
    throw 'NPM_TOKEN is not set. It needs read:packages, for the engine on GitHub Packages - see the repo README.'
}

$registry = 'ghcr.io/jacob12244'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$sha = (git -C $repoRoot rev-parse --short HEAD).Trim()
$shaTag = "sha-$sha"

# Warn but do not block: the sha tag only names committed code.
$dirty = git -C $repoRoot status --porcelain
if ($dirty) { Write-Warning "Working tree has uncommitted changes - the :$shaTag tag will not match the image contents exactly." }

# The Filter plant map is local only: its model and its baked world are kept
# out of git, so it ships only when both are on this disk. Say which it is.
$model = Join-Path $repoRoot 'public\local\plant.glb'
$world = Join-Path $repoRoot 'server\worlds\cad.bin.gz'
$hasModel = Test-Path $model
$hasWorld = Test-Path $world
if ($hasModel -and $hasWorld) {
    if ((Get-Item $world).LastWriteTime -lt (Get-Item $model).LastWriteTime) {
        throw 'server\worlds\cad.bin.gz is older than public\local\plant.glb - run npm run bake, or the page and the server will hold different worlds.'
    }
    Write-Host '==> the Filter plant map goes in (public\local\plant.glb, server\worlds\cad.*)' -ForegroundColor Cyan
} elseif ($hasModel -or $hasWorld) {
    throw 'Only half the Filter plant map is here: public\local\plant.glb and server\worlds\cad.* go together.'
} else {
    Write-Warning 'No Filter plant model on this disk (public\local\plant.glb) - these images will not have that map. Build from a checkout that has it to keep it.'
}

$targets = if ($Only) { @($Only) } else { @('web', 'arena') }
foreach ($name in $targets) {
    $image = "$registry/pasteworks-$name"
    Write-Host "==> building $image ($shaTag)" -ForegroundColor Cyan
    & docker build -f (Join-Path $PSScriptRoot "$name\Dockerfile") `
        --secret id=npm_token,env=NPM_TOKEN `
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
