$ErrorActionPreference='Stop'
$pack=Split-Path $PSScriptRoot
$app=Join-Path (Split-Path $pack) 'app'
$setup=Join-Path $pack 'setup'
$manifest=Join-Path $pack 'out/packages.tsv'
$lock=Get-Content (Join-Path $app 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
$lines=foreach($rel in $lock.packages.Keys){
    if(!$rel.StartsWith('node_modules/')){continue}
    $pkg=$lock.packages[$rel]
    if($pkg.dev -or ($pkg.os -and 'win32' -notin $pkg.os) -or ($pkg.cpu -and 'x64' -notin $pkg.cpu)){continue}
    $name=$rel.Substring(13)
    $name+[char]9+$pkg.version
}
[IO.File]::WriteAllLines($manifest,[string[]]$lines)
$fx=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$out=Join-Path $pack 'out\payload\app\scripts\carnot-recovery.exe'
& "$fx/csc.exe" /nologo /target:winexe /optimize+ /platform:x64 "/out:$out" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.FileSystem.dll "/resource:$manifest,packages.tsv" "/resource:$app\package.json,package.json" "/resource:$setup\relink-modules.cjs,relink-modules.cjs" "$setup\Environment.cs" "$setup\DependencyRecovery.cs"
if ($LASTEXITCODE) { throw 'Could not build dependency recovery.' }
