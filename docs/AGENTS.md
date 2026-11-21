# Architecture guide for agents

Windows desktop, Linux packages and source installations run the same Node.js backend and Svelte UI. Windows adds a native shell and setup program. The Linux packages open the local server in a browser. Start with the application code for changes to research behavior and the packaging code for installation or upgrades.

## Follow a request

1. From source, `npm start` runs the compiled Node server entry point. The Linux launcher selects the data directory and starts the backend. On Windows the desktop shell waits for the packaged Node process to open its loopback port and opens that address in WebView2. [Server entry](../app/src/server/index.ts) · [Linux launcher](../desktop-packaging/linux/start.mjs) · [Windows shell](../desktop-packaging/shell/src/main.rs)
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

The provider SDK handles OAuth. CAgE supplies the HTML for its loopback result pages through the narrow module hook in [oauth-branding.ts](../app/src/runtime/oauth-branding.ts). When updating the SDK, check both callback handlers, including an invalid state and a completed local callback. The provider controls its own consent screen.

## Reproduce and verify a change

Use Node 24.19 or later within 24.x and npm 11.9. Run these commands from `app/`. For manual testing, set `CARNOT_DATA_DIR` to an empty, writable local directory on a filesystem that supports hard links. Each running server needs its own workspace.

| Action | Expected result |
| --- | --- |
| `npm ci --ignore-scripts` | Installs the dependency versions in the lockfile, including build tools. |
| `npm run check` | TypeScript and Svelte checks pass, then the backend and web UI are emitted under `dist/`. |
| `npm start` | The server prints `CAgE is running at http://127.0.0.1:<port>`. Open that address to see the start page and sidebar. The default port is 4327 and the actual port is printed if it is occupied. Use Exit in the UI or Ctrl+C in the terminal to release the workspace. |
| `node scripts/check-research-providers.mjs` | Uses a temporary workspace and fixture responses for GPT (API and ChatGPT subscription), Claude, Grok, DeepSeek, GLM, Kimi and Gemini. Prints results for valid and invalid tool arguments, project completion through `/start`, and the archived manuscript count. Requires a current build and filesystem hard links. Credentials are supplied by the test. |
| `node scripts/check-report-publications.mjs` | Prints a PASS for report attribution, replay deduplication and project isolation. |

For a provider bug, start in [pi-runtime.ts](../app/src/runtime/pi-runtime.ts) to see which model and tools the stage supplies. Follow the outgoing declaration in [structured-output.ts](../app/src/runtime/structured-output.ts), the HTTP dispatch guard in [provider-transport.ts](../app/src/runtime/provider-transport.ts), and the incoming native tool events in [tool-argument-audit.ts](../app/src/runtime/tool-argument-audit.ts). The local schema and argument checks run before a tool can change project state. Add a regression at the failing boundary and run the provider test through project completion. [Role settings and provider matrix](ROLE_MODELS.md#provider-tool-calls)
