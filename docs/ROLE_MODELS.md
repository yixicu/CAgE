# V4 role and stage models

Open Settings → Models & connections and connect the providers you want to use. Choose a model and, for models that support it, a thinking level. Save models stores the workspace defaults. New V4 sessions and explicit start boundaries copy these settings. An epoch keeps its frozen selections across restart and recovery. Changes to workspace settings apply at the next eligible boundary.

Choose a connected provider and click **Refresh model list** to update its catalog. The first run uses the bundled Pi list. Later launches restore refreshed model descriptors from local storage. Built-in providers such as Anthropic, Google, OpenAI, DeepSeek and xAI load compatible chat entries from the public Pi catalog. CAgE sends no account key to this directory. Providers check model access when called. OpenRouter retains Pi’s key-specific filtering, and Radius uses its own discovery mechanism.

| Setting | Work performed | Inherits from |
| --- | --- | --- |
| Theorist | Main research, tool use, routing, judgments and the final public report | CAgE default model |
| Optional Worker | Both auxiliary and way Workers when the Theorist requests them | CAgE default model |
| Moderator | Moderator reviews, including strategy admission across eligible proof cases | CAgE default model |
| Learning | Checkpoint learning from proof cases, route decisions and qualifying failures | Theorist |
| Post-report research | Research and review of the released report and authorized evidence after the public report has been saved | Moderator |
| Knowledge Map maintenance | New background map tasks and their review | Moderator |
| Maintenance Assistant | Interactive maintenance conversation | CAgE default model, then the selected project's default if available |

The Theorist produces the final report in the same response that concludes or pauses research. Selecting a post-report model controls the subsequent independent assessment. Selecting an Optional Worker model takes effect when a Worker is requested. V4 source reads run inside the calling role's tool access.

An admitted map task keeps its original model when retried. The alternate field proposal after a declined field uses the source report's frozen Theorist when available. Learning fallback models retain their existing retry order and apply separately from the primary Learning selection.

Removing an override restores the inheritance shown in the table, including the inherited thinking level. Settings from workspaces created before the stage selectors use these same inheritance rules.

## Provider tool calls

Select the Pi provider that matches the credential you obtained. For example, Moonshot API keys and Kimi Coding credentials use different connections. Choose a tool-capable model from that connection, save it as the Theorist, and start a new project to exercise the selection.

| Model family | Pi provider | Representative model in the offline research test | Native tool protocol |
| --- | --- | --- | --- |
| GPT | `openai` | `gpt-6.1-sol` | OpenAI Responses |
| Claude | `anthropic` | `claude-sonnet-4-6` | Anthropic Messages |
| Grok | `xai` | `grok-4.7` | OpenAI Responses |
| DeepSeek | `deepseek` | `deepseek-v4-pro` | OpenAI Chat Completions |
| GLM | `zai` | `glm-5.3` | OpenAI Chat Completions |
| Kimi | `moonshotai` | `kimi-k3` | OpenAI Chat Completions |
| Kimi Coding | `kimi-coding` | `k3` | Anthropic Messages |
| Gemini | `google` | `gemini-3.1-pro-preview` | Google Generative AI |

These examples use the descriptors in the locked Pi catalog. The test sends a research request through CAgE and the provider SDK, supplies local HTTP fixtures, checks tool arguments, and verifies the archived manuscript. Account entitlements, model availability, quotas and model behavior on a real research problem require the corresponding live service. A refreshed catalog can list models outside this test matrix. Google Vertex AI uses a separate Pi adapter and is outside the verified Gemini API path.

When diagnosing a failure, record the role, provider, model ID, research version, stage and displayed error. A 401 or 403 points to the credential or the account's access to that endpoint. A 429 indicates a service limit. For `STRICT_OUTPUT_UNSUPPORTED`, check the selected protocol and the project's handoff version. Older projects using `cage-strict-1` require an endpoint with explicit strict-schema support. For an invalid tool delivery, inspect the named tool and field in the round record. A missing field, an interrupted response and a provider rejection require different fixes. Remove keys, tokens and private research text before sharing a diagnostic.
