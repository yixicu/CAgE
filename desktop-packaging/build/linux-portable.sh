#!/usr/bin/env bash
# Assemble the system-Node edition from a completed browser production build.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out="$root/desktop-packaging/out"
version=$(sed -n 's/^[[:space:]]*"version": "\([0-9.]*\)",.*/\1/p' "$root/desktop-packaging/shell/tauri.conf.json")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
test -f "$root/app/dist/web/index.html"
mkdir -p "$out/linux" "$out/release"
stage=$(mktemp -d "$out/linux/portable-XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
pkg="$stage/Carnot-$version"
mkdir -p "$pkg/docs" "$pkg/scripts"
cp -R "$root/app/dist" "$root/app/plugins" "$pkg/"
cp "$root/app/package.json" "$root/app/package-lock.json" "$root/desktop-packaging/linux/start.mjs" "$root/docs/LICENSE" "$pkg/"
cp "$root/app/scripts/subagent-host.mjs" "$root/app/scripts/subagent-session.mjs" "$pkg/scripts/"
cp "$root/docs/MAINTENANCE.md" "$root/docs/ROLE_MODELS.md" "$root/docs/SUBAGENTS.md" "$root/docs/THIRD_PARTY_NOTICES.md" "$pkg/docs/"
cat > "$pkg/README.txt" <<'EOF'
CAgE for Linux — system Node edition

Use Node.js 24.19 or later in the 24.x series and npm 11.9.
In this extracted directory, run:

  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  node start.mjs

The first command installs locked production dependencies. The second opens the app
in your browser. For headless use, run node start.mjs --no-browser.
To drive research with a Codex session, follow docs/SUBAGENTS.md.
EOF
name="Carnot-$version-linux-system-node.tar.gz"
tar --owner=0 --group=0 --mode='u+rwX,go+rX,go-w' -C "$stage" -czf "$stage/$name" "Carnot-$version"
mv "$stage/$name" "$out/release/$name"
(cd "$out/release"; sha256sum "$name" > "$name.sha256")
