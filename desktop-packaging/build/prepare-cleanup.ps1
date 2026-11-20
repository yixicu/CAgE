$ErrorActionPreference='Stop'
$pack=Split-Path $PSScriptRoot
[void][IO.Directory]::CreateDirectory((Join-Path $pack 'out'))
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize+ /target:winexe "/out:$pack\out\remove-carnot-environment.exe" "$pack\setup\RemovePrivate.cs"
if ($LASTEXITCODE){throw 'Private environment cleanup helper failed to compile.'}
