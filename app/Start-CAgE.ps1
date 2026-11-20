param(
    [string]$NodePath = 'node',
    [string]$DataDir = $env:CARNOT_DATA_DIR,
    [int]$Port = $(if ($env:CARNOT_PORT) { $env:CARNOT_PORT } else { 4327 }),
    [switch]$Build,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$node = (Get-Command $NodePath -ErrorAction Stop).Source
if ((& $node --version) -notmatch '^v24\.') { throw 'CAgE requires Node.js 24. Pass its executable with -NodePath.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) { throw 'Dependencies are missing. Run npm ci in the app directory before starting CAgE.' }
if ($Build -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist/server/index.js'))) {
    Push-Location $PSScriptRoot
    try {
        & $node 'node_modules/typescript/bin/tsc' -p tsconfig.json
        if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed.' }
        & $node 'node_modules/vite/bin/vite.js' build
        if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
    } finally { Pop-Location }
}
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Choose a port between 1 and 65535.' }
$dataArgument = if ($DataDir) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DataDir) } else { '--port' }
$launchOutput = & $node (Join-Path $PSScriptRoot 'scripts/launch.mjs') $dataArgument $Port
if ($LASTEXITCODE -ne 0) { throw 'CAgE could not start; see the error above.' }
$launchOutput | ForEach-Object { Write-Host $_ }
$launchAddress = @($launchOutput | Where-Object { $_ -match '^CAgE: http://127\.0\.0\.1:\d+$' })
if ($launchAddress.Count -ne 1) { throw 'CAgE did not return a verified local address.' }
if (-not $NoBrowser) { Start-Process $launchAddress[0].Substring(6) }
