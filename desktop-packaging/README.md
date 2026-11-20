# Windows desktop build

The desktop package uses a Tauri shell, the system WebView2 runtime, and the same Svelte frontend and Node.js backend as the browser edition.

## Build Windows x64

Use a Windows x64 Visual Studio developer shell with MSVC, Windows SDK, .NET Framework 4.x compiler and WPF assemblies available. Install Node.js 24.19 or later in the 24.x series, Rust with the MSVC target, and Tauri CLI 2. Use PowerShell 7 to run the build. The optional CARNOT_TAURI_CLI environment variable can point to the JavaScript entry point of an existing Tauri CLI installation.

~~~powershell
npm ci --ignore-scripts
cargo install tauri-cli --version "^2" --locked
.\desktop-packaging\build\windows.ps1
~~~

The script stages the application, builds the native shell and NSIS core, and embeds the core in the English WPF installer. The distributable setup executable and its SHA-256 checksum appear in desktop-packaging/out/release. For another build after modifying the application, move the generated out/payload directory aside to refresh the staged assets.

## Install and remove

The installer offers separate choices for Node.js, production packages, the basic physics map, and the desktop shortcut. An exact local package tree can be shared. Mixed installations use an application-owned private tree and verify freshly downloaded packages against the release lockfile. Start the installed program from the Start menu. Windows Installed Apps can remove the application and its private runtime. User workspaces and external shared packages remain available.
