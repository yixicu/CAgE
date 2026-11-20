# Maintaining a V4 knowledge workspace

Open **System maintenance** and select the destination before sending a request. Select a V4 project for its knowledge map or **Shared Skill / Strategy library** for method cards. Enable **Allow changes** for a turn that should write. Each operation has a recorded result and the final reply summarizes the turn. A follow-up can refer to a previous operation in the same scope.

## Files and directories

Carnot stores local application data in `.carnot-data/` under the application root by default. Set `CARNOT_DATA_DIR` to select an external data directory. Project records live under `projects/`, attached notes under `maintenance/notes/`, and provider credentials under `pi/auth/` within the selected data directory. Keep that directory private when sharing the application. The repository map identifies the source, UI, scripts and documentation directories. [Repository map](REPOSITORY_MAP.md)

## Import a note

1. Select the project, choose **Attach a note**, and enter an instruction. For example, “Read the attached derivation. Compare it with existing nodes. Add missing definitions and the supported theorem, and connect each to the exact premises it uses.”
2. Send with **Allow changes** enabled. For a preview, leave it unchecked and ask for proposed changes. To apply the proposal later, stay in the same scope, enable writes, and refer to the previous note.
3. The assistant reads the selected UTF-8 text in pages. Markdown, plain text, LaTeX source, CSV and textual JSON are supported. Each request accepts one note of up to 200,000 characters. For longer notes, divide at scientific section boundaries and include the needed assumptions. Convert scanned or binary documents to text before attaching.
4. The assistant lists existing entries, opens the exact matching versions and writes justified additions or revisions. The original text is kept under the application data directory in `maintenance/notes/` as a Markdown or plain-text file. The turn records its name and content hash. Each theorem write includes the supplied proof, its conditions, exact premises and the assistant’s review of the decisive inference. A gap should be reported with the specific missing step. To verify the result, ask “Show the title, version, premises and attached proof of the node you just wrote.”

## Install the core map in a project

1. Start Carnot, create a V4 project, and keep the server running. Use the loopback URL printed at startup. In the same browser, open `/api/projects` on that origin to find the project ID. At `/api/research/knowledge-map?projectId=PROJECT_ID`, read `profile.version`.
2. Place the complete **core map** folder anywhere convenient. Open a terminal inside it and run the commands below. Substitute the actual URL, project ID and profile version. The first command validates the package locally.

```sh
node core-map.mjs
node core-map.mjs http://127.0.0.1:4327 PROJECT_ID PROFILE_VERSION
```

3. To accept every packaged foundation as a project premise, append `--accept-foundations` to the **first import** after examining the foundations. Otherwise the user can accept individual premises separately. Retry the same batch with the original arguments.
4. Inspect the project map or ask Maintenance to list a title and show its supplied proof. The seed receipt records the imported versions. Source text and an attached proof are readable immediately. Scientific qualification and user acceptance are separate. Import records every node and its declared links immediately. To qualify a supplied proof, select the project, enable **Allow changes**, and ask Maintenance to inspect the existing argument and its premises. For a measurement, ask it to check the source excerpt, conditions, value, units and uncertainty. Attach the original source excerpt when needed. Inspect the recorded qualification before requesting another review.

## Export and import a personal map

Run these commands from the application repository. Use a new directory for the export and a V4 project as the destination. Replace the example origin and IDs with the values obtained above.

```sh
node scripts/project-map.mjs export http://127.0.0.1:4327 SOURCE_PROJECT ./my-map
node scripts/project-map.mjs import http://127.0.0.1:4327 TARGET_PROJECT ./my-map PROFILE_VERSION
```

The output contains `map.json` (versions, provenance, links and checksums), `statements/*.md` and `proofs/*.md`. Transfer the whole folder. To revise a Markdown file, attach it to Maintenance as a new source. The package importer checks the original file hashes. The export records project-local entries, their versions and scientific links. The import selects current transferable statements and measurements and submits them as new seeds. The source project’s review decisions, historical versions and foundation selections stay in the snapshot. Canonical theory projections and references to materials owned by another project require their original sources. Retrying the same package with the initial profile version reuses its import receipt. The destination qualifies evidence and accepts foundations under its own authority. Inspect the reported counts of imported entries and skipped entries or links, then verify representative nodes and their proof text in the destination.

Maintenance can explain these commands through the guide. Run folder transfers in the local terminal. To import an ordinary note conversationally, use **Attach a note**.

## Manage Skills and Strategies

Select **Shared Skill / Strategy library**. Ask for the node by title. Maintenance lists matches and opens the selected version before editing. Enable **Allow changes** for the following requests.

| Request | Operation | Expected result |
|---|---|---|
| “Create a Skill for checking a boundary condition before choosing a solution route.” | Create a method Skill. Supply a short title, tags, applicability and one transferable action per Markdown bullet line. | A versioned card with its Markdown body. Maintenance-created cards start disabled pending scientific review. |
| “Create a Strategy for selecting a symmetry reduction.” | Create a specific Strategy. State the route preference and why it applies in one short paragraph. | A versioned Strategy in the shared library. |
| “Revise this card using these conditions.” | Read the exact version, preserve its applicable content, then submit the replacement. | A new revision awaiting review. If a concurrent change intervenes, read the latest version before reapplying the requested edit. |
| “Retire this card.” | Identify the exact version and retire it. | The shared card is retired across projects and its history remains available. |

In project scope the same operations target editable scientific nodes. For a metadata-only theorem edit, retain the body and assumptions to preserve existing support. Measurements, canonical theory projections and accepted premises have separate controls.
