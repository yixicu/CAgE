[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$node=(Get-Command node.exe -ErrorAction Stop).Source
function Invoke-Tauri([string[]]$Arguments) {
    if ($env:CARNOT_TAURI_CLI) { & $node $env:CARNOT_TAURI_CLI @Arguments }
    else { & cargo tauri @Arguments }
}
$pack=Split-Path $PSScriptRoot
& $node "$PSScriptRoot\stage.mjs"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& (Join-Path $PSScriptRoot "prepare-cleanup.ps1")
Push-Location "$pack\shell"
try {
    Invoke-Tauri @('build','--no-bundle','--','--locked')
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally { Pop-Location }
# NSIS opens resource paths with traditional Win32 path-length limits.
$drive=@('Q:','R:','S:','T:') | Where-Object {!(Test-Path "$_\")} | Select-Object -First 1
if (!$drive) {throw 'No free temporary drive letter for NSIS.'}
subst.exe $drive $pack
if ($LASTEXITCODE) {throw 'Could not map the packaging directory.'}
Push-Location "$drive\shell"
try {
    Invoke-Tauri @('bundle','--bundles','nsis')
    $bundleExit=$LASTEXITCODE
} finally {
    Pop-Location
    subst.exe $drive /D
}
if ($bundleExit) {exit $bundleExit}
& (Join-Path $PSScriptRoot "setup.ps1")