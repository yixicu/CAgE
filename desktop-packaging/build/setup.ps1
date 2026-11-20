param([string]$Version='0.2.5')
$ErrorActionPreference='Stop'
$pack=Split-Path $PSScriptRoot
$repo=Split-Path $pack
$setup=Join-Path $pack 'setup'
$core=Join-Path $pack "shell\target\release\bundle\nsis\Carnot Agent Engine_$($Version)_x64-setup.exe"
$fx=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$out=Join-Path $pack 'out\release'
[void][IO.Directory]::CreateDirectory($out)
$exe=Join-Path $out "Carnot-$Version-windows-x64-setup.exe"
$manifest=Join-Path $pack 'out\packages.tsv'
$lock=Get-Content (Join-Path $repo 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
$lines=foreach($rel in $lock.packages.Keys){
    if(!$rel.StartsWith('node_modules/')){continue}
    $pkg=$lock.packages[$rel]
    if($pkg.dev -or ($pkg.os -and 'win32' -notin $pkg.os) -or ($pkg.cpu -and 'x64' -notin $pkg.cpu)){continue}
    $name=$rel.Substring(13)
    $name+[char]9+$pkg.version
}
[IO.File]::WriteAllLines($manifest,[string[]]$lines)
$refs=@('System.dll','System.Core.dll','System.Xaml.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll','WPF\PresentationCore.dll','WPF\PresentationFramework.dll','WPF\WindowsBase.dll') | ForEach-Object {"/reference:$(Join-Path $fx $_)"}
$map=Join-Path $pack 'out/basic-physics-map.mjs'
[IO.File]::WriteAllText($map,'export default '+[IO.File]::ReadAllText((Join-Path $repo 'web/core-preview.json'))+';')
$argsList=@("/resource:$map,physics-map.js",'/nologo','/target:winexe','/platform:x64','/optimize+',"/out:$exe","/win32icon:$pack\shell\icons\icon.ico","/resource:$core,core.exe","/resource:$setup\Setup.xaml,Setup.xaml","/resource:$repo\web\public\branding\engine-a-v4.png,mark.png","/resource:$manifest,packages.tsv","/resource:$repo\package-lock.json,package-lock.json","/resource:$repo\package.json,package.json")
& "$fx\csc.exe" @argsList @refs "/resource:$setup\packages.mjs,packages.mjs" "$setup\Setup.cs" "$setup\Environment.cs"
if($LASTEXITCODE){throw 'Setup compilation failed.'}
$hash=(Get-FileHash $exe).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$exe.sha256","$hash  $([IO.Path]::GetFileName($exe))"+[Environment]::NewLine)
Get-Item $exe | Select-Object Name,Length
