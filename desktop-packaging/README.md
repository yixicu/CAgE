# Desktop builds

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

Use a writable local filesystem that supports hard links for the workspace and any separate research or system-record folders. NTFS on Windows and ext4 on Linux support the writer lock and immutable research records. FAT32 and exFAT lack hard links.

### Moved dependencies on Windows

At startup, the desktop launcher checks the saved Node executable and the installed package tree. If either location is missing or incompatible, use **Detect on this device** or **Browse** in the recovery window, then confirm with **Use location**. For Node, choose the executable or its containing folder. For packages, choose the shared `node_modules` directory or its parent. Confirmed locations are saved for this installation. Cancelling exits without starting the backend.

An upgrade checks dependencies before replacing program files and offers the same recovery window for moved locations, including upgrades from 0.2.9. The updater can reuse packages from the previous version and prepare any changed dependencies for the new release.

## Publish a desktop update

1. Make the changes in a clean checkout of yixicu/CAgE. Set the next numeric desktop version (for example, 0.2.7) in the version field of desktop-packaging/shell/tauri.conf.json.
2. Check the changes with `npm --prefix app run check`, then build the Windows installer and Linux system-Node tarball. Validate a fresh installation and an upgrade from the previous release with a disposable workspace. On Linux, extract the tarball and verify the printed address, bundled Core map and project map helper.
3. Commit the source and public documentation to main. Tag that exact commit with the same version prefixed by v, for example v0.2.7, and push the commit and tag. Review the staged files before pushing.
4. In GitHub Releases, create a draft for that tag. From `desktop-packaging/out/release`, attach `Carnot-<version>-windows-x64-setup.exe`, `Carnot-<version>-linux-system-node.tar.gz` and each file’s adjacent `.sha256` checksum. Keep the generated filenames. Publish as the latest full release after all four assets have uploaded. Use a new, higher version for each update.
5. On a machine running the previous update-capable version, open Settings → Plugins & general → Desktop updates and check for updates.

The desktop app reads GitHub's latest stable release when requested. Private repositories require access to the repository and a personal token with Contents: read for that repository. The user enters their own token in the app when requested. For a public repository, GitHub normally allows unauthenticated update checks. Source commits, tags alone, drafts and pre-releases do not deliver a stable update.

Version 0.2.5 predates the update controls. To enable them, fully exit that version and run the 0.2.6 setup once. Later supported releases can be installed from Settings.

## Publish a Core map revision

Edit `app/web/core-preview.json`. Keep each existing node's key stable so updates preserve references. Stage the revised map, then run `node app/scripts/prepare-core-map-release.mjs 2` from the repository root, substituting the next Core map version. The script computes the Git blob ID from the staged bytes and the SHA-256 digest from the parsed seed records. Build the app, run `node app/scripts/check-core-map-updates.mjs`, and commit the map and its generated manifest together to main.

Settings → Plugins & general → Core map updates checks that manifest on demand. Installation verifies the immutable blob and applies one local transaction. The installer retains manually reviewed, edited and withdrawn node families when an upstream revision changes. Existing projects keep their own foundation selections. A map publication can ship independently of a desktop release.

## Linux installation

Download the system-Node archive and its adjacent SHA-256 checksum from the release. With Node.js 24.19 or later in the 24.x series and npm 11.9 installed, run the following in the download directory, replacing the version with the one you downloaded. [Releases](https://github.com/yixicu/CAgE/releases/latest)

```sh
version=0.2.16
sha256sum -c "Carnot-$version-linux-system-node.tar.gz.sha256"
tar -xzf "Carnot-$version-linux-system-node.tar.gz"
cd "Carnot-$version"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node start.mjs
```

CAgE opens the loopback address in the default browser. For a headless launch, use `node start.mjs --no-browser`. Press Ctrl+C to stop. Both Linux editions store data under `$XDG_DATA_HOME/cage`, normally `~/.local/share/cage`. Set `CARNOT_DATA_DIR` to choose a different workspace on a filesystem that supports hard links. To upgrade, stop the old process and repeat the install commands in a freshly extracted directory, using the same data location.

The package loads the bundled basic physics map into a new workspace on startup. It includes the project map transfer helper and the Codex session host and client. Their guides are `docs/MAINTENANCE.md` and `docs/SUBAGENTS.md` inside the package.

## Build Linux packages

With the locked development dependencies installed, run `npm --prefix app run build` and `bash desktop-packaging/build/linux-portable.sh` from the repository root. The portable build uses Bash, GNU tar and sha256sum. It writes the archive and checksum to `desktop-packaging/out/release/`.

To build a self-contained Debian package on Linux x86-64, put the official x64 Node 24.19+ (24.x) distribution and npm on PATH. Set `NODE_LICENSE` to that distribution’s LICENSE file and run `bash desktop-packaging/build/linux.sh`. This build also uses ar and dpkg-deb. Install the resulting package using `sudo apt install ./Carnot-0.2.16-linux-amd64.deb` from the output directory, substituting the built version. Start CAgE from the applications menu or run `carnot-agent-engine --no-browser`. The installation bundles Node and production dependencies under `/opt/carnot-agent-engine`. Install a newer .deb to upgrade.
