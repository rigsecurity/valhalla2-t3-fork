# Shared knowledge with Memorywell

Memorywell keeps reusable engineering knowledge under the repository where it applies. Agents capture useful findings with sources as they work. Future agents check those sources against the current checkout before relying on the note. Verified common knowledge can also reach other repositories.

## Share one environment

Choose one Valhalla2 T3 environment to hold the team's memory. Register the repositories the team uses there, with their Git remotes configured. Connect each participating endpoint to that same environment. Its SQLite database is authoritative; separate T3 installations do not automatically synchronize their databases.

T3 uses the registered project's repository identity to select knowledge, such as `github.com/acme/app`. Repository names alone are not enough. An agent running inside T3 is limited to its own project's memory and verified common knowledge. An outside client selects a registered project explicitly.

Access uses the environment's existing grants. An outside client with read-only access can retrieve memory. A client approved for changes can also capture notes. That grant includes other T3 operations, so connect users to an environment with appropriate project access.

## Connect native Claude Code

In the shared environment, use **Settings → Environments → Copy MCP URL**. On the computer where Claude Code runs:

```sh
claude mcp add --transport http t3 https://<environment-address>/mcp
claude mcp login t3
claude mcp list
```

Replace the example address with the copied URL. Use OAuth sign-in and approve the access you intend to give. Do not put credentials in a repository or in these commands. Remote sign-in needs HTTPS; localhost is also supported. See [Outside agents](outside-agents.md) for pairing, headless sign-in, access choices and revocation.

Valhalla2 gives agents a short prompt to consult Memorywell before unfamiliar work and capture findings worth reusing. To give native Claude the same workflow, distribute the [Rig Memorywell skill](../../packages/valhalla2/native/skills/rig-memorywell/SKILL.md) in the team's Claude plugin or under `.claude/skills/rig-memorywell/` in a project. For a native Codex pilot, place the same skill under `.agents/skills/rig-memorywell/`. The [native Claude instructions](../../packages/valhalla2/native/CLAUDE.md) can also be added to an existing project `CLAUDE.md`.

Outside Valhalla2, the skill uses `t3_project_list` to match the checkout's remote and passes the resulting project ID to Memorywell. The hosted harness uses the current project.

An agent captures a short note with a reason and one to four sources. The reasons cover costly research, repository conventions, and repeatable pitfalls. Ordinary tasks can finish without writing a note.

## Check and correct knowledge

Open **Knowledge** in Valhalla2 to inspect notes and their sources. Agent notes are available to the same repository immediately. A person can verify a note after checking the current code, a meaningful test result, or a reviewed change. Verified notes take precedence over agent notes on the same topic.

A correction starts as a new proposal for the same repository and topic. Replacing an existing verified entry requires an explicit `memory.supersede` operation with both current revisions. Concurrent decisions are refused if either version changed. The previous entry remains in history and stops appearing in retrieval. This milestone exposes supersede through the maintainer RPC API with settings access; the panel supports proposing and verifying.

The legacy importer preserves topic aliases, source paths, source dates and source references. It requires an explicit mapping from old repository names to full repository identities, excludes retired repositories and imports notes as proposals. An old `active` label is not treated as new proof. The `memory.import` operation uses the maintainer RPC API with settings access in this milestone. It does not automatically read anyone's existing Valhalla data.

Search uses words, paths, and role cues. Results include relevant agent notes and verified knowledge in the selected repository, plus verified common knowledge. Searching by entry ID can focus a shortened result.
