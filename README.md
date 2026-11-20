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

## References

Pi provides the runtime. The other projects below informed specific design decisions in CAgE's research engine.

| Project | What CAgE drew on |
| --- | --- |
| [All Agentic Architectures](https://github.com/FareedKhan-dev/all-agentic-architectures) | Critique and verification patterns for research rounds. |
| [Claude Code](https://github.com/anthropics/claude-code) | Structured tool results and feedback when a tool call fails. |
| [Codex](https://github.com/openai/codex) | Parsing native tool calls during agent handoffs. |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | Modular plugin interfaces around a small core. |
| [GraphRAG](https://github.com/microsoft/graphrag) | Community summaries for navigating a large knowledge collection. |
| [GTPyhop](https://github.com/dananau/GTPyhop) | Refining high-level tasks into steps for reusable research strategies. |
| [Harness²](https://github.com/google-research/harness2) | Retrieving evidence from an index and validating proposed changes to learned material. |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Loading a skill's details when its summary matches the task. |
| [LangGraph](https://github.com/langchain-ai/langgraph) | Explicit inputs and outputs for reusable subgraphs. |
| [Pi](https://github.com/earendil-works/pi) | Agent sessions, model providers, authentication and tool execution. |
| [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) | Handling malformed structured output in proof submission. |
| [Soar](https://github.com/SoarGroup/Soar) | Learning reusable procedures from solved subproblems. |
