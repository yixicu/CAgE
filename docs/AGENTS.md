# Architecture guide for agents

The Windows and browser editions run the same Node.js backend and Svelte UI. The desktop build adds a native shell and setup program. Start with the application code for changes to research behavior. Start with the packaging code for changes to installation, upgrades or native window behavior.

## Follow a request

1. The browser launcher starts the server. In the desktop edition the Rust shell starts the packaged Node process, waits for its loopback port and opens that address in WebView2. [Browser launcher](../app/scripts/launch.mjs) · [Desktop shell](../desktop-packaging/shell/src/main.rs)
2. The Svelte client bootstraps the workspace, sends local API requests and consumes events. The server checks the local request token and wires the routes to the engine, store, runtime and learning services. [UI entry](../app/web/App.svelte) · [Client API](../app/web/api.ts) · [Server composition](../app/src/server/app.ts)
3. The research facade dispatches to the versioned implementation for the project. V4 is the current UI default. Preserve the contracts and replay behavior of existing projects when changing research flows. [Engine facade](../app/src/engine/) · [Research versions](../app/src/research/versions/) · [Shared contracts](../app/src/research/contracts/)
4. The runtime invokes the configured provider through Pi and supplies the tools allowed for that stage. Project records and checkpoints are written by the backend. The UI reads those records through the API. [Runtime](../app/src/runtime/) · [Storage](../app/src/storage/)

## Find the code to change

| Area | Owner |
| --- | --- |
| Sessions, settings, maintenance conversations, local routes and GitHub release checks | [app/src/server](../app/src/server/) |
| Role definitions, research stages and scientific handoffs | [app/src/agents](../app/src/agents/), [app/src/research](../app/src/research/) |
| Skills, Strategies, map nodes and their revisions | [app/src/learning](../app/src/learning/); read [Maintenance](MAINTENANCE.md) for supported edits |
| Files, workspace selection and checkpoints | [app/src/storage](../app/src/storage/); tool permissions and reads in [app/src/tools](../app/src/tools/) |
| Shared types and presentation contracts | [app/src/shared](../app/src/shared/), [app/src/presentation](../app/src/presentation/) |
| Tabs, cages, settings, theme and layout | [app/web](../app/web/); the optional bundled physics map is [core-preview.json](../app/web/core-preview.json) |
| Plugin registry and example manifest | [app/src/plugins](../app/src/plugins/) and [app/plugins](../app/plugins/); check [version-specific integration limits](PLUGINS.md) before adding tool-dependent behavior |
| Windows setup, environment selection, upgrades and shell | [desktop-packaging/setup](../desktop-packaging/setup/), [desktop-packaging/shell](../desktop-packaging/shell/) and [desktop-packaging/build](../desktop-packaging/build/) |

## Build and data boundaries

Run npm commands from app/, where the manifest, lockfile, Node version, TypeScript and Vite configurations live. After installing the locked dependencies, run **npm run check** to typecheck and build both backend and UI. The default browser workspace is app/.carnot-data. The installed desktop layout uses payload/app for the program and defaults to workspace under the selected installation directory. Settings → Research can redirect system records and project outputs independently.

Keep personal research workspaces, learned cards, provider authentication, logs and test fixtures outside source control. The repository ships application code, documentation, the example plugin and the optional basic physics map. Generated app/dist and desktop-packaging/out are local build products. Update behavior relies on tagged GitHub Releases and their verified installer assets. [Desktop packaging](../desktop-packaging/README.md)
