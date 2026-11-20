# Carnot Agent Engine (CAgE)

CAgE is a local-first workspace for theoretical research. Start with a hypothesis, investigate it with a connected model, and keep the sources, proofs, open questions and reusable methods together.

**Windows desktop:** download the x64 setup from [Releases](https://github.com/yixicu/CAgE/releases/latest). Connect a provider in **Settings → Models & connections**. From desktop version 0.2.6, check for new releases in **Settings → Plugins & general**.

**Browser edition:** with Node.js 24.19 or later in the 24.x series and npm 11.9, run:

~~~sh
cd app
npm ci --ignore-scripts
npm run build
npm start
~~~

Open the local address printed by the server. Research files and provider credentials stay in your chosen workspace. Research requests go to the provider you configure.

## Project guide

| Folder | What you will find |
| --- | --- |
| [app](app/) | The shared research engine, browser interface, launch scripts and bundled plugin manifest. |
| [desktop-packaging](desktop-packaging/) | The Windows shell, installer, updater and [release instructions](desktop-packaging/README.md). |
| [docs](docs/README.md) | The documentation index, including the [architecture guide for agents](docs/AGENTS.md), maintenance operations and plugin development. |

[MIT license](docs/LICENSE)
