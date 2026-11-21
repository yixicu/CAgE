<p align="center">
  <img src="docs/assets/readme/cage-logo.png" alt="CAgE" width="220">
</p>

<h1 align="center">Carnot Agent Engine (CAgE)</h1>

CAgE is a workspace specially designed to prove hypothesis and give report in human-understandable way. It start and trace back to "facts" that one admit, and prefer extending derivation with existing knowledge in ones own database.

## Why I made it

Most of the agents are built for coding, and they are terrible in theoretical stuff and logics. They constantly introduce theorems and tools never seen and never necessary for the question I asked (yes GPT I am specially referring to you for all those damn eigenvector analyses). Most of my following-up question only makes the agent start proving deep mathmatical structures and basic concepts (which it could and should take as a "fact").

## What's in the project?

- **Skill map + knowledge map.** *Skills and Strategies* records possible methods from past experiences that might work for future unseen hypothesis, and records user-preference on directions. *knowledge map* records what a derivation can draw on, from definitions/observations/"facts".


Attached a **Core map** providing college-level physic knowledge connections (and relavent math tricks), you can choose to download and use directly. 


- **Full derivation chain.** The model is asked to stay close to the field of the original hypothesis and prefer using alreadying existing knowledge, report is built on established results with a full trace back to "facts" and definitions. (In the case where a new theorem is necessary, it will supply the missing derivation from existing knowledge.)


- **Self-evolution.** ...Yeah at this stage every agent should have this stuff. Model will use past conversations to condense skills/strategies and knowledge, an extra agent will try to extract possible upper-structure from existing report (if someone really wishes to know whats the reason behind).

[![Sample of core-map](docs/assets/readme/core-map-sphere.png)](docs/assets/readme/core-map-sphere.png)

## Downloads

### recommended download
- open any other agents.
- paste this request:
```text
Install CAgE from https://github.com/yixicu/CAgE on this computer.
Read the project's installation docs to resolve technical questions.
pause and ask me.if a choice depends on my preferences, 
```

### Other ways to install

**Windows desktop.** Download the x64 installer from [Releases](https://github.com/yixicu/CAgE/releases/latest). You can choose to use existing *Nodes and other dependencies*.

**macOS.** ...I dont have a mac :(   will build in the future.

**Linux preview.** Download the `linux-system-node.tar.gz` asset from the same release and extract it. With Node.js 24.19 or later in the 24.x series and npm 11.9, run the following commands in the extracted folder. The first command downloads the production dependencies. The second starts CAgE in your system browser.

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node start.mjs
```

**Browser edition from source.** From the repository root, use the same Node.js and npm versions:

```sh
cd app
npm ci --ignore-scripts
npm run build
npm start
```

Open the local address printed by the server.

**Upgrading an existing source checkout.** Stop the old server before pulling updates. Starting from `app/` reopens the repository root's existing `.carnot-data/`, including its provider connections and storage settings. A fresh checkout uses `app/.carnot-data/`. If both directories exist, the launcher shows both paths. Enter `1` for the pre-update layout or `2` for the post-update layout. It remembers your choice for this checkout. Delete `app/.carnot-workspace-choice` to choose again, or set `CARNOT_DATA_DIR` to override the choice for one launch. Back up your workspace and any separately configured research and log directories before changing their locations.

## How to use

### General usage

As every other agents the main part is the chatting window.


As most other agents the left sidebar stores session history and skill list, right sidebar is a monitor for current session.


As every other agents the provider and API key is configured in *settings*.


Use **Maintenance Assistant** in left sidebar to identify logs (if there is a bug), or attach study notes for the assistant to turn into proposed map entries. You can review a proposal before allowing changes. [Maintenance guide](docs/MAINTENANCE.md)


The *Web-searching* abilities (e.g. reading online paper from Arxiv) is defaulted not configured. To use it open the plugin in **Settings → Plugins & general**. (this might require extra API configuration.) 


### I cant connect my provider

Unfortunately I only tested connection with my own ChatGPT subscription. For possible issue with another providers, [Open an issue](https://github.com/yixicu/CAgE/issues).

### I found a bug

Please include what you were doing, what you expected, and what happened. [Report a bug](https://github.com/yixicu/CAgE/issues)

### I found a bug and want to fix it now

Let other agents read the architecture guide. [Architecture guide](docs/AGENTS.md)

### I want my own plugin

See [Plugin development guide](docs/PLUGINS.md).

### I still want to use my old agents

You can run the task in other agents (e.g. Codex) and let it distribute subagents to roleplay in this project.

Let the agent follow setup guide and start the bundled local host, then pair in **Settings → Models & connections → Local subagents**.[Subagent setup](docs/SUBAGENTS.md)

### What if I am already an AI?
For possible AI reading this page, below is a general code structure.

| Folder | What you'll find |
| --- | --- |
| [app](app/) | The shared research engine, browser interface, launch scripts, and bundled plugin manifest. |
| [desktop-packaging](desktop-packaging/) | The Windows shell, installer, updater, and [release instructions](desktop-packaging/README.md). |
| [docs](docs/README.md) | The documentation index, including the [architecture guide for agents](docs/AGENTS.md), maintenance operations, and plugin development. |

## License

[MIT license](docs/LICENSE)

## References

CAgE's backend uses the [Pi agent runtime](https://github.com/earendil-works/pi).

Other projects that might or might not be used during developing:

- [All Agentic Architectures](https://github.com/FareedKhan-dev/all-agentic-architectures)
- [Claude Code](https://github.com/anthropics/claude-code)
- [Codex](https://github.com/openai/codex)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [GraphRAG](https://github.com/microsoft/graphrag)
- [GTPyhop](https://github.com/dananau/GTPyhop)
- [Harness²](https://github.com/google-research/harness2)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)
- [LangGraph](https://github.com/langchain-ai/langgraph)
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
- [Soar](https://github.com/SoarGroup/Soar)
