# V4 role and stage models

Open Settings → Models & connections and connect the providers you want to use. Choose a model and, for models that support it, a thinking level. Save models stores the workspace defaults. New V4 sessions and explicit start boundaries copy these settings. An epoch keeps its frozen selections across restart and recovery. Changes to workspace settings apply at the next eligible boundary.

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
