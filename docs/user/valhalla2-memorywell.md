# Shared knowledge with Memorywell

Memorywell keeps reusable engineering knowledge under the repository where it applies. Verified common knowledge can also reach other repositories. New findings remain proposals until a person checks the evidence and verifies them in the Valhalla2 Memorywell panel. Agents cannot verify or promote their own proposals through MCP.

## Share one environment

Choose one Valhalla2 T3 environment to hold the team's memory. Register the repositories the team uses there, with their Git remotes configured. Connect each participating endpoint to that same environment. Its SQLite database is authoritative; separate T3 installations do not automatically synchronize their databases.

T3 uses the registered project's repository identity to select knowledge, such as `github.com/acme/app`. Repository names alone are not enough. An agent running inside T3 is limited to its own project's memory and verified common knowledge. An outside client selects a registered project explicitly.

Access uses the environment's existing grants. An outside client with read-only access can retrieve memory. A client approved for changes can also submit proposals; that grant includes other T3 operations and is not a memory-only permission. Use an environment whose project access is appropriate for everyone you connect.

## Connect native Claude Code

In the shared environment, use **Settings → Environments → Copy MCP URL**. On the computer where Claude Code runs:

```sh
claude mcp add --transport http t3 https://<environment-address>/mcp
claude mcp login t3
claude mcp list
```

Replace the example address with the copied URL. Use OAuth sign-in and approve the access you intend to give. Do not put credentials in a repository or in these commands. Remote sign-in needs HTTPS; localhost is also supported. See [Outside agents](outside-agents.md) for pairing, headless sign-in, access choices and revocation.

Ask Claude to call `t3_project_list` and match the intended repository. It should pass that project's `projectId` to `memorywell_retrieve`, with a short question and relevant paths. For example: “Find the registered Acme app project, then look up the team's lessons about migration tests.”

After checking a reusable finding, Claude can call `memorywell_propose` with a topic, title, short summary, explanation and supporting source references. A retry uses the same `idempotencyKey` and content. A changed claim uses a new key. The response states whether it is waiting for verification or already recorded.

The optional [native Claude instructions](../../packages/valhalla2/native/CLAUDE.md) can be copied into a repository's existing `CLAUDE.md`. They encourage retrieval before unfamiliar work and evidence-backed proposals afterward. Native Claude does not load them automatically, and instructions do not enforce participation. T3's Valhalla2 launch path adds its own memory context; a separately installed native CLI needs this connection and explicit instructions.

## Check and correct knowledge

Open the Valhalla2 panel and select Memorywell to inspect proposals and their sources. Verify a claim only after checking the current code, a meaningful test result or a reviewed change. A recorded attestation is not an independent test run. Shared memory may be wrong or stale; agents should check it against the code they are changing.

A correction starts as a new proposal for the same repository and topic. Replacing an existing verified entry requires an explicit `memory.supersede` operation with both current revisions. Concurrent decisions are refused if either version changed. The previous entry remains in history and stops appearing in retrieval. This milestone exposes supersede through the maintainer RPC API with settings access; the panel supports proposing and verifying.

The legacy importer preserves topic aliases, source paths, source dates and source references. It requires an explicit mapping from old repository names to full repository identities, excludes retired repositories and imports notes as proposals. An old `active` label is not treated as new proof. The `memory.import` operation uses the maintainer RPC API with settings access in this milestone. It does not automatically read anyone's existing Valhalla data.

Search currently uses words, paths and role cues. Results contain only verified entries in the selected scope and common knowledge. MCP responses cap the total returned body text and mark shortened results; searching for a specific entry id focuses the next response on that entry. Empty results mean no verified match, not that the team has never worked on the subject.
