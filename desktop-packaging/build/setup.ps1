param()
$ErrorActionPreference='Stop'
$pack=Split-Path $PSScriptRoot
$app=Join-Path (Split-Path $pack) 'app'
$setup=Join-Path $pack 'setup'
$Version=(Get-Content (Join-Path $pack 'shell/tauri.conf.json') -Raw | ConvertFrom-Json).version
$core=Join-Path $pack "shell\target\release\bundle\nsis\Carnot Agent Engine_$($Version)_x64-setup.exe"
$fx=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$out=Join-Path $pack 'out\release'
[void][IO.Directory]::CreateDirectory($out)
$exe=Join-Path $out "Carnot-$Version-windows-x64-setup.exe"
$manifest=Join-Path $pack 'out\packages.tsv'
$refs=@('System.dll','System.Drawing.dll','System.Core.dll','System.Xaml.dll','System.Windows.Forms.dll','System.Web.Extensions.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll','WPF\PresentationCore.dll','WPF\PresentationFramework.dll','WPF\WindowsBase.dll') | ForEach-Object {"/reference:$(Join-Path $fx $_)"}
$map=Join-Path $pack 'out/basic-physics-map.mjs'
$versionFile=Join-Path $pack 'out/setup-version.txt'
[IO.File]::WriteAllText($versionFile,$Version)
[IO.File]::WriteAllText($map,'export default '+[IO.File]::ReadAllText((Join-Path $app 'web/core-preview.json'))+';')
$argsList=@("/resource:$map,physics-map.js",'/nologo','/target:winexe','/platform:x64','/optimize+',"/out:$exe","/win32icon:$pack\shell\icons\icon.ico","/resource:$core,core.exe","/resource:$setup\Setup.xaml,Setup.xaml","/resource:$app\web\public\branding\engine-a-v4.png,mark.png","/resource:$manifest,packages.tsv","/resource:$app\package-lock.json,package-lock.json","/resource:$app\package.json,package.json")
& "$fx\csc.exe" @argsList @refs /main:Setup "/resource:$setup\relink-modules.cjs,relink-modules.cjs" "$setup\DependencyRecovery.cs" "/resource:$versionFile,version.txt" "/resource:$setup\packages.mjs,packages.mjs" "$setup\Setup.cs" "$setup\Environment.cs" "$setup\Upgrade.cs" "$setup\RemovePrivate.cs"
if($LASTEXITCODE){throw 'Setup compilation failed.'}
$hash=(Get-FileHash $exe).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$exe.sha256","$hash  $([IO.Path]::GetFileName($exe))"+[Environment]::NewLine)
Get-Item $exe | Select-Object Name,Length
