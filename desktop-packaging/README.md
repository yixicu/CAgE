# Windows desktop build

The desktop package uses a Tauri shell, the system WebView2 runtime, and the same Svelte frontend and Node.js backend as the browser edition.

## Build Windows x64

Use a Windows x64 Visual Studio developer shell with MSVC, Windows SDK, .NET Framework 4.x compiler and WPF assemblies available. Install Node.js 24.19 or later in the 24.x series, Rust with the MSVC target, and Tauri CLI 2. Use PowerShell 7 to run the build. The optional CARNOT_TAURI_CLI environment variable can point to the JavaScript entry point of an existing Tauri CLI installation.

~~~powershell
npm --prefix app ci --ignore-scripts
cargo install tauri-cli --version "^2" --locked
.\desktop-packaging\build\windows.ps1
~~~

The script stages the application, builds the native shell and NSIS core, and embeds the core in the English WPF installer. The distributable setup executable and its SHA-256 checksum appear in desktop-packaging/out/release. Each build refreshes the staged backend and frontend before bundling.

## Install and remove

The installer offers separate choices for Node.js, production packages, the basic physics map, and the desktop shortcut. An exact local package tree can be shared. Mixed installations use an application-owned private tree and verify freshly downloaded packages against the release lockfile. Start the installed program from the Start menu. Windows Installed Apps can remove the application and its private runtime. User workspaces and external shared packages remain available.

## Publish a desktop update

1. Make the changes in a clean checkout of yixicu/CAgE. Set the next numeric desktop version (for example, 0.2.7) in the version field of desktop-packaging/shell/tauri.conf.json.
2. Check the changes with `npm --prefix app run check`, then build the Windows installer using the instructions above. Validate both a fresh installation and an upgrade from the previous release with a disposable workspace.
3. Commit the source and public documentation to main. Tag that exact commit with the same version prefixed by v, for example v0.2.7, and push the commit and tag. Review the staged files before pushing.
4. In GitHub Releases, create a draft for that tag. Attach both Carnot-0.2.7-windows-x64-setup.exe and Carnot-0.2.7-windows-x64-setup.exe.sha256 from desktop-packaging/out/release. Keep those filenames unchanged. Publish it as the latest full release after both uploads finish. Use a new, higher version for each update.
5. On a machine running the previous update-capable version, open Settings → Plugins & general → Desktop updates and check for updates.

The desktop app reads GitHub's latest stable release when requested. Private repositories require access to the repository and a personal token with Contents: read for that repository. The user enters their own token in the app when requested. For a public repository, GitHub normally allows unauthenticated update checks. Source commits, tags alone, drafts and pre-releases do not deliver a stable update.

Version 0.2.5 predates the update controls. To enable them, fully exit that version and run the 0.2.6 setup once. Later supported releases can be installed from Settings.