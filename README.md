# Carnot Agent Engine (CAgE)

CAgE is specially designed for theoretical theorem analysis. Instead of extending the AI power we intend to restrict it...for better use.

### why do I make it
Most agents focuses on code-building, and their theoretical derivation is terrible: They dont know what I know, and consistently throwing me new knowledges when I ask it to derive something... and major AI models (yes GPT I'm referring to you) tends to apply very unnecessarily complicated methods to analyse even the simpliest problems (e.g. doing those nonsensing eigenvector/eigenvalue analysing), and wasting time trying to prove very basic stuffs that I would just recognise as "*fundamental facts*".

### whats in the project
- **skill map + knowledge map**: *skill map* instruct LLM to prefer what direction/fields and prefer what knowledges, and *knowledge map* is grown from "*fundamental facts*", definitions and observational results.
  An initial core-map is provided (and hopefully will be constantly updating), containing knowledge from college level physics and relavent math tricks.
- **Full derivation chain**: Every theorem beyond existing knowledge is asked to derive. Models are commanded to prefer existing directions and steps close to the original fields of the hypothesis and use only the knowledge that has been already proven. (In the case that a new knowledge is necessary to be introduced, models are asked to complete the knowledge map up to the used theorem for consistency.)
- **Self-evolution**: ... Yeah at this stage every agent should have this stuff. This agent will try to concise every conversation and try to condense revalent knowledge (that will be added to map). An external agent will examine multiple conversations and condense user-preferred directions and workable directions to skill/strategies, and examine knowledge for possible upper-structures.

## downloads

### best way to download
- open an agent (e.g. ChatGPT/Claude Code).
- paste below commands in texting window:
~~~
I want to install this [[project url](https://github.com/yixicu/CAgE)], install for me, pause and ask me for advice if you cannot decide **Non-technical problems**; go to the project and read relavent documents for **technical problems**.
~~~

### other ways to download

**Windows desktop:** download the x64 setup from [Releases](https://github.com/yixicu/CAgE/releases/latest). Connect a provider in **Settings → Models & connections**. Check for new releases in **Settings → Plugins & general**.

**Mac version**: i dont have a mac :(  ...will build in the future.

**Linux preview:** download the `linux-system-node.tar.gz` asset from the same release and extract it. With Node.js 24.19 or later in the 24.x series and npm 11.9, run `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` inside the extracted folder, then `node start.mjs`. This starts CAgE in your system browser. The package includes the compiled application. Its first-time setup downloads production dependencies. 

**Browser edition:** with Node.js 24.19 or later in the 24.x series and npm 11.9, run:

~~~sh
cd app
npm ci --ignore-scripts
npm run build
npm start
~~~

Open the local address printed by the server.

**Upgrading an existing source checkout:** stop the old server before pulling updates. Starting from `app/` reopens the repository root's existing `.carnot-data/`, including its provider connections and storage settings. A fresh checkout uses `app/.carnot-data/`. If both directories exist, the source launcher shows both paths. Enter 1 for the pre-update layout or 2 for the post-update layout. It remembers the choice for this checkout. Delete `app/.carnot-workspace-choice` to choose again, or set `CARNOT_DATA_DIR` to override it for a launch. Back up your workspace and any separately configured research and log directories before changing their locations.

## How to use?

### General useage
As most other agents the major part is a texting window where you can put hypothesis inside and click "send". 

As most other agents (...as far as how I use) the left pannel is a collection of those skills and histories, and right pannel is a monitor of current conversation.

As most other agents the providers and API keys configurations are in *Settings*.

In left pannel I equipped a "maintenance" agent specially for possible bug-identifying, it can look into logs and all other stuffs in case there is some problem. The maintenance agent also helps you input and modify skills/knowledges if you want to import existing ones (e.g. your studying notes).

In settings-Plugin you can chose to give agent web-searching abilities for reading online papers (e.g. Arxiv), this might require extra API configuration.

### Cannot configure provider
Unfortunately up to now I only tested my GPT subscription, for other model configuring issue please push an *Issue* to let me know.

### There is a bug
Handle an *Issue* to this project.
### There is a bug...and I want to fix it now!
Let other agents read relavent documents and fix it.

### I still want to use my old agents

You can let your agent create subagents to roleplay in this project.

To delegate research to independent agents in a running external (e.g. Codex) session, pair the bundled local host in **Settings → Models & connections**.

Honestly I recommend directly letting your agents read [Subagent setup](docs/SUBAGENTS.md), most of the instructions are intended designed to be AI-to-AI style.

### I am already an AI agent?

For possible AI agent reading this, below is a brief of code structure provided.

| Folder | What you will find |
| --- | --- |
| [app](app/) | The shared research engine, browser interface, launch scripts and bundled plugin manifest. |
| [desktop-packaging](desktop-packaging/) | The Windows shell, installer, updater and [release instructions](desktop-packaging/README.md). |
| [docs](docs/README.md) | The documentation index, including the [architecture guide for agents](docs/AGENTS.md), maintenance operations and plugin development. |


## License
[MIT license](docs/LICENSE)

## References

Backend runtime built and modified based on [Pi](https://github.com/earendil-works/pi). 

Other projects that might or might not be used:
- [All Agentic Architectures](https://github.com/FareedKhan-dev/all-agentic-architectures)
- [Claude Code](https://github.com/anthropics/claude-code)
- [Codex](https://github.com/openai/codex)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [GraphRAG](https://github.com/microsoft/graphrag)
- [GTPyhop](https://github.com/dananau/GTPyhop)
- [Harness²](https://github.com/google-research/harness2)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)
- [LangGraph](https://github.com/langchain-ai/langgraph)
- [Pi](https://github.com/earendil-works/pi)
- [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
- [Soar](https://github.com/SoarGroup/Soar)

