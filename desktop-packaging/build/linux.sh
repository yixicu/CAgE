#!/usr/bin/env bash
# Build from an existing Linux x64 Node 24 installation and a production app/dist.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
pack="$root/desktop-packaging"
[[ $(uname -sm) == 'Linux x86_64' ]]
node -e 'if (process.platform !== "linux" || process.arch !== "x64" || !/^24\./.test(process.versions.node) || Number(process.versions.node.split(".")[1]) < 19) process.exit(1)'
test -f "$root/app/dist/web/index.html"
version=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).version' "$pack/shell/tauri.conf.json")
mkdir -p "$pack/out/linux" "$pack/out/release"
stage=$(mktemp -d "$pack/out/linux/build-XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
image="$stage/image"
app="$image/opt/carnot-agent-engine"
mkdir -p "$app" "$image/usr/bin" "$image/usr/share/applications" "$image/usr/share/pixmaps" "$stage/control"
cp -R "$root/app/dist" "$root/app/plugins" "$app/"
cp "$root/app/package.json" "$root/app/package-lock.json" "$pack/linux/start.mjs" "$app/"
mkdir -p "$app/docs" "$app/scripts"
cp "$root/app/scripts/subagent-host.mjs" "$root/app/scripts/subagent-session.mjs" "$app/scripts/"
cp "$root/docs/MAINTENANCE.md" "$root/docs/THIRD_PARTY_NOTICES.md" "$root/docs/SUBAGENTS.md" "$root/docs/ROLE_MODELS.md" "$app/docs/"
cp "$root/docs/LICENSE" "$app/"
cp "$(command -v node)" "$app/node"
cp "${NODE_LICENSE:?Set NODE_LICENSE to the bundled Node distribution LICENSE}" "$app/NODE-LICENSE"
npm ci --prefix "$app" --omit=dev --ignore-scripts --no-audit --no-fund
printf '%s\n' '#!/bin/sh' 'exec /opt/carnot-agent-engine/node /opt/carnot-agent-engine/start.mjs "$@"' > "$image/usr/bin/carnot-agent-engine"
chmod +x "$image/usr/bin/carnot-agent-engine" "$app/node"
cp "$pack/linux/cage.desktop" "$image/usr/share/applications/carnot-agent-engine.desktop"
cp "$root/app/web/public/branding/engine-96.png" "$image/usr/share/pixmaps/carnot-agent-engine.png"
cat > "$stage/control/control" <<EOF
Package: carnot-agent-engine
Version: $version
Architecture: amd64
Maintainer: CAgE <yixicu@users.noreply.github.com>
Depends: libc6 (>= 2.28), libstdc++6, libgcc-s1, xdg-utils
Description: Local research workspace for theoretical physics
EOF
# Build the standard Debian members with explicit ownership and permissions.
# This also works on a Windows-mounted WSL filesystem.
printf '2.0\n' > "$stage/debian-binary"
tar -C "$stage/control" --owner=0 --group=0 --mode=0644 -czf "$stage/control.tar.gz" ./control
tar -C "$image" --owner=0 --group=0 --mode='u+rwX,go+rX,go-w' -czf "$stage/data.tar.gz" .
name="Carnot-$version-linux-amd64.deb"
(cd "$stage"; ar rcD "$name" debian-binary control.tar.gz data.tar.gz; dpkg-deb --info "$name")
mv "$stage/$name" "$pack/out/release/$name"
(cd "$pack/out/release"; sha256sum "$name" > "$name.sha256")
