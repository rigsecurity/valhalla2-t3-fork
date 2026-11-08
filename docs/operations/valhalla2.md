# Valhalla2 pilot setup

This fork starts from T3 v0.1.7, upstream commit
[`322f6544dfad0a3c8a0c8cbecf2c7f7874b14268`](https://github.com/pingdotgg/t3code/commit/322f6544dfad0a3c8a0c8cbecf2c7f7874b14268).
Keep T3's provider, thread, worktree, Git, and review services as the runtime foundation. See
[Development](development.md) for the standard `vp` toolchain.

Install dependencies and start an isolated development environment without copying local seed
data:

```sh
vp i
vp run dev --no-seed
```

Configure Jira on the server process for ticket lookup. These are server-side environment
variables; keep the token in your normal secret manager and never commit it:

```sh
VALHALLA2_JIRA_URL=https://your-team.atlassian.net
VALHALLA2_JIRA_EMAIL=you@example.com
VALHALLA2_JIRA_TOKEN=<Jira API token>
```

Choose one Valhalla2 T3 environment as the team's shared-memory authority. Connect participating
users and agent endpoints to that same environment; independent local SQLite stores do not sync.
Configure the shared Memorywell endpoint and OAuth access as described in the
[Memorywell setup guide](../user/valhalla2-memorywell.md).

For a small pilot, open `/valhalla2`, register the team's repository in T3, select one Jira ticket,
and inspect the work and review threads. Check the reviewed revision before publishing. Valhalla2
does not automatically merge pull requests or mark work accepted; a person reviews and records
acceptance and outcome measurements.
