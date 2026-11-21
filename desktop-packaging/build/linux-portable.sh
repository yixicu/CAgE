#!/usr/bin/env bash
# Assemble the system-Node edition from the application sources.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out="$root/desktop-packaging/out"
version=$(sed -n 's/^[[:space:]]*"version": "\([0-9.]*\)",.*/\1/p' "$root/desktop-packaging/shell/tauri.conf.json")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
mkdir -p "$out/linux" "$out/release"
stage=$(mktemp -d "$out/linux/portable-XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
pkg="$stage/Carnot-$version"
bash "$root/desktop-packaging/build/stage-linux.sh" "$pkg"
cat > "$pkg/README.txt" <<'EOF'
CAgE for Linux — system Node edition

Use Node.js 24.19 or later in the 24.x series and npm 11.9.
In this extracted directory, run:

  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  node start.mjs

The first command installs locked production dependencies. The second opens the app
in your browser. For headless use, run node start.mjs --no-browser and open the
printed loopback address. Press Ctrl+C to stop. The default workspace is
$XDG_DATA_HOME/cage or ~/.local/share/cage. Set CARNOT_DATA_DIR to choose another
workspace. Use writable local storage that supports hard links, such as ext4.
The basic physics map loads on first launch. To transfer a project map, follow
docs/MAINTENANCE.md. To drive research with a Codex session, follow docs/SUBAGENTS.md.
EOF
name="Carnot-$version-linux-system-node.tar.gz"
tar --owner=0 --group=0 --mode='u+rwX,go+rX,go-w' -C "$stage" -czf "$stage/$name" "Carnot-$version"
mv "$stage/$name" "$out/release/$name"
(cd "$out/release"; sha256sum "$name" > "$name.sha256")
