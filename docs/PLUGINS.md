# Developing a bundled plugin

CAgE loads trusted TypeScript factories from a catalog compiled into the application. The shipped example counts words, characters and lines in supplied text. **Install** changes local catalog state. Adding a new plugin to a release requires a source change and a rebuild. The host runs plugin code in the application process with the same OS privileges as the server. Review the implementation and its imports before adding a factory.

## Start from the existing extension points

### Web search

The V4 foreground Theorist can use `read_document` without installing a search provider or entering a key. Paste a public HTTP(S) URL in the question, or upload a PDF. The reader accepts those sources, links in delivered web text and results from an authorized web search. It returns text with continuation offsets, supports passage lookup, and reads PDFs by physical page. For ambiguous equations or layouts a vision-capable model can request an image of the original page. Direct reads contact the origin and run locally, support static HTML, plain text and PDF, and limit downloads to 20 MiB. Login sessions and JavaScript rendering are outside this reader.

In **Settings → Plugins & general**, install **Web search**, choose Firecrawl, Tavily or Exa, and follow **Get an API key**. Save the key and enable the plugin. Each provider offers a free tier and maintains its own credit limits. Only the selected provider receives search queries and URLs opened with `open_web_result`. Each provider has a separate locally stored key.

Enabling search gives the foreground Theorist access in existing and future V4 projects. Expand **Project exceptions** and check a project to disable its search access. Changing providers or excluding a project revokes affected tool handles. Direct URL and PDF reading remains available independently.
 Settings expose only whether a key is saved. Use **Remove key** to clear it. The backend reads the current key on each call. A missing or rejected key, quota error, timeout, or provider outage returns an ordinary “Web search is temporarily unavailable” tool result so the Theorist can continue. Successful reads include the URL, access time, and up to 16,000 characters of source text. Search again after a restart or a new grant to reopen a result.

| Source | What to look for |
| --- | --- |
| [Host and interfaces](../app/src/plugins/index.ts) | `TrustedPlugin`, `ScopedPluginApi`, manifest and grant validation, catalog, activation and revocation |
| [Executable example](../app/src/plugins/text-statistics.ts) | `textStatisticsPlugin`, its inline manifest, TypeBox argument schema and Pi tool result |
| [Example manifest](../app/plugins/examples/text-statistics.manifest.json) | JSON representation for reference. Discovery reads the compiled catalog. |
| [Application composition](../app/src/server/app.ts) | Host startup, local HTTP routes, event delivery and per-session tool resolution |
| [Pi session construction](../app/src/runtime/pi-runtime.ts) | Role and version filters applied after tool resolution |
| [Settings UI](../app/web/PluginSettings.svelte) and [API client](../app/web/api.ts) | Installed/enabled controls and the client method for granting a capability |

A manifest has exactly seven fields. Use a unique `id` matching `^[a-z0-9-]{1,64}$`, strings for `name`, `description` and `version`, the string `"1"` for `hostApi`, and arrays for `requestedCapabilities` and `roleScopes`. Supported roles are `theorist`, `worker`, `moderator` and `literature`. The host validates capability names and rejects unknown fields and duplicate catalog IDs. The plugin version is descriptive. The host does not negotiate semantic versions.

| Capability | API and consumption |
| --- | --- |
| `tool.firecrawl-search` | The bundled web search plugin supplies `web_search` and `open_web_result` to the authorized V4 foreground Theorist. |
| `tool.text-statistics` | `registerTool(capability, tool)` accepts only the reviewed tool named `text_statistics`. Its parameter is `{text: string}`, limited to 200,000 UTF-16 code units by the implementation. It returns counts under `details` and as JSON in a text content block. |
| `retrieval.read` | `registerRetriever({name, retrieve})` registers an async query function returning records with `sourceId`, `locator` and `text`. The host exposes these through `retrieversFor(projectId, role)`. The application currently has no consumer for this list. |
| `events.read` | `subscribeEvents(handler)` delivers cloned project research events. A role grant authorizes a subscription, but the delivery filter matches the project ID only. A listener can receive events concerning other roles in that project. Settings-change events are excluded. |
| `strategy.macro` | `registerStrategyProvider(provider)` is available to the Theorist role. V2 strategy selection uses these providers. The host qualifies a provider ID as `pluginId@version:providerId`, freezes its policy input and validates returned domain IDs, anchor IDs, rationale, uncertainty and normalized mode weights. See the [strategy contract](../app/src/research/contracts/v2.ts). |

## Add a factory

1. Add a TypeScript module under `app/src/plugins/` exporting a `TrustedPlugin`. Give it an inline manifest and a synchronous `activate(api, scope)`. Activation runs separately for every project and role with a nonempty grant. Keep per-grant state inside the activation function.
2. Register only capabilities present in `scope.capabilities`. A grant may be a subset of the requested capabilities. Each registration returns a disposable handle. Keep callbacks and any resources they own scoped to the intended lifetime. The factory interface has no deactivation callback.
3. Import the reviewed factory in `app/src/plugins/index.ts` and include it in the constructor's default catalog alongside `textStatisticsPlugin`. Run `npm run check` from `app/`, then restart the rebuilt application. A desktop distribution also needs an updated application payload.
4. For a new tool name or capability, extend the capability and registration checks, specify its argument and result contracts, and add it to the intended role/version consumer. Verify the final model-facing tool list for that stage. Adding a manifest, returning a tool from a factory, or passing the runtime's tool-name validation alone cannot grant a proof stage access.

For example, a project event subscriber can count deliveries in process. This factory registers one listener per grant.

```ts
import type { TrustedPlugin } from './index.js';

export const eventCounter: TrustedPlugin = {
  manifest: {
    id: 'event-counter',
    name: 'Project event counter',
    description: 'Count project research events delivered to this grant.',
    version: '1.0.0',
    hostApi: '1',
    requestedCapabilities: ['events.read'],
    roleScopes: ['moderator'],
  },
  activate(api, scope) {
    if (scope.capabilities.includes('events.read')) {
      let count = 0;
      api.subscribeEvents(() => {
        console.debug('Project research events', scope.projectId, ++count);
      });
    }
  },
};
```

## Install, grant and revoke

In **Settings → Plugins & general**, install the bundled plugin and enable it. The web search plugin provides project exceptions there. For the example plugin use the local API to grant a project and role access.

Use the running application's local origin. Read `requestToken` from `GET /api/bootstrap` and send it in `x-carnot-token` on subsequent API requests. Use an existing project ID from `GET /api/projects`. Successful plugin routes return an array containing each catalog entry's manifest, `installed`, `enabled` and `grants`.

| Request | Effect |
| --- | --- |
| `GET /api/plugins` | Discover reviewed catalog entries. |
| `POST /api/plugins/text-statistics/install` with `{}` | Mark the bundled factory installed. |
| `POST /api/plugins/text-statistics/enable` with `{}` | Allow grants to activate the factory. |
| `PUT /api/plugins/text-statistics/grants` | Replace one project/role grant. Send `{"projectId":"YOUR_PROJECT_ID","role":"moderator","capabilities":["tool.text-statistics"]}`. Send the same pair with `"capabilities":[]` to revoke it. |
| `POST /api/plugins/text-statistics/disable` with `{}` | Revoke all live registrations and clear all grants. Re-enabling requires fresh grants. |
| `DELETE /api/plugins/text-statistics` | Unload, revoke all grants and clear installed/enabled state. The bundled entry remains discoverable. |

The host persists installed/enabled state and grants in `plugins.json` under the active research data directory. On restart it reactivates enabled grants against the compiled catalog. A failure during activation, tool execution, retrieval, strategy recommendation or synchronous event handling disables that plugin and clears its grants in memory. Use the API to inspect current state before retrying. The API maps unknown plugins to HTTP 404, invalid manifests/grants or denied operations to 400, and plugin failures to 409.

## Verify the intended research path

The grant controls what the host can return. Each research loop separately chooses what reaches a model.

| Path | Tool behavior |
| --- | --- |
| V0 | Uses its own memory-tool resolver. |
| V1 / V2.0 | The normal research-session resolver includes tools for the exact project and role. Later session-stage restrictions still apply. |
| V2.1 | The resolver includes scoped tools for non-Worker research sessions. Worker sessions start with an empty resolved tool list. |
| V3 / V4 proof | The proof adapter keeps selected built-in reads and the result handoff, then constructs the reviewed operation set. It filters out `text_statistics`. |
| V4 post-report Moderator | Constructs stage-specific tools independently in the [Moderator runtime](../app/src/runtime/theory-v4-r5.ts). |
| Background learning | Uses a dedicated learning-tool resolver. |

To check the bundled tool inside the server process after granting the Moderator scope, use the same host owned by the running application. There is no HTTP tool-execution endpoint.

```js
const [statistics] = app.carnot.plugins.toolsFor(projectId, 'moderator');
const result = await statistics.execute('example', { text: 'alpha beta\ngamma' });
console.log(result.details); // { characters: 16, words: 3, lines: 2 }
```

An offline lifecycle check created a V4 project using the authenticated local API, installed and enabled the plugin, granted the Moderator scope and obtained these exact counts. Other project/role pairs returned no tool. Restart restored the grant. Clearing or disabling it rejected a retained tool handle with `PLUGIN_DENIED`. Uninstall cleared the installed flag. In a separate revision-5 V4 Moderator research call with a local fixture model, the model-facing tools were `finish_research`, `continue_research`, `request_review` and `read_research_source`. The count came from the direct host invocation.
