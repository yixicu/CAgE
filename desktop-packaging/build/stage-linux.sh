#!/usr/bin/env bash
# Shared application files for the system-Node tarball and Debian installation.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
app=${1:?Supply the package application directory}
mkdir -p "$app/scripts" "$app/docs/assets/readme"
cp -R "$root/app/dist" "$root/app/plugins" "$app/"
cp "$root/app/web/core-preview.json" "$app/dist/web/core-preview.json"
cp "$root/app/package.json" "$root/app/package-lock.json" "$root/desktop-packaging/linux/start.mjs" "$root/docs/LICENSE" "$app/"
cp "$root/app/scripts/"{project-map,subagent-host,subagent-session}.mjs "$app/scripts/"
cp "$root/docs/"{MAINTENANCE,ROLE_MODELS,SUBAGENTS,THIRD_PARTY_NOTICES}.md "$app/docs/"
cp "$root/docs/assets/readme/core-map-plane.png" "$app/docs/assets/readme/"
