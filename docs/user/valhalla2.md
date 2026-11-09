# Valhalla2

Open **Valhalla2** in the sidebar, or search for it in the command palette. If you have multiple
environments, choose the one that owns your repository. Use **Appearance** to switch between
light, dark, and system mode for the whole app or change your fonts. A fresh web or desktop
install starts with the Rig palette and follows the system appearance.
The workspace is available on web and desktop,
including the web app at phone widths. There is no dedicated native mobile workspace yet;
ordinary agent threads remain available in T3's mobile app.

New chats open with one of 60 movie lines picked for starting work, taking on a challenge,
or having a laugh about the task ahead. The line and film credit stay with the draft. Choose
a project below it or use **Start without a project** to work in a scratch space. The lines
were checked against the [Wikiquote film catalog](https://en.wikiquote.org/wiki/Category:Films)
and studio sources.

## Knowledge that carries forward

Agents save useful findings after costly research, confirming a repo convention, or finding a
repeatable pitfall. **Knowledge** lets you find these notes by repository, topic, or title.
Future agents can use a captured note after checking its sources against the current checkout.

Use **Read sources** to see what supports a note. Verified guidance takes precedence when a
topic has both kinds of note. For a manual addition, choose **Add a note** and include a source.
Team-wide notes use the `common` scope and need verification.

Engineers connected to the same environment share its memory. An endpoint on your machine does not automatically synchronize
other environments; your administrator must configure access to a shared service.

Ticket implementers and reviewers receive the repository's `testing/how-to-verify` note when
one is available. The short recipe points to test commands and setup details agents have
confirmed. They check it against the current checkout before using it. A verified recipe takes
priority over a captured one.

The [rig-verify-work skill](../../.agents/skills/rig-verify-work/SKILL.md) gives regular chats
the same playbook for looking up and capturing useful verification steps. Install it once with
your provider's project skills to make it available in that repository. It uses the repo's own
test instructions when Memorywell is unavailable.

## Work your way

In **My workflows**, select or create a personal profile. Start with Claude alone, use skills,
or choose separate planning and review models. Names must match the providers and models
available on your environment. Optional tools remain your choice and must be installed in the
selected provider. The skill availability panel helps identify missing skills.
Profiles stay with this trusted T3 connection and do not sync between separate environments.

Choose a repository and base branch under **Start a chat your way**, describe the work, and
start. The new chat uses your selected profile's implementation model and skills, with shared
knowledge and an isolated worktree. Separate planning and review stages apply to ticket runs;
they are not silently added to a freestyle chat. Profile changes apply to new launches, not
every existing T3 thread.

Shared knowledge, measurement, and isolated worktrees remain required. These do not require
everyone to use the same skills or models. Existing threads, native skills, queue, and steering
controls remain available. After changing provider skills or tools, use **Restart agent session**
from the command palette and refresh the workspace.

## From a ticket to a pull request

In **Ticket work**, enter a Jira key and choose **Read ticket**. Review the request, select a
repository, profile, and base branch, then start. Jira must be configured on that environment.
Work takes place in an isolated worktree.

Open the work thread to answer questions or steer the agent. **Check progress** refreshes the
run and continues the workflow when the current stage is complete. Follow any requested input
in the thread. Use **Take over** to stop automation and continue in the work thread, or **Stop
run** to end it. **Request repair** sends failed or reviewed work back to implementation within
your profile's attempt limit. A failure stays visible with its reason; it is not counted as success.

The ticket branch needs a committed change against its base before it can move to review.
When a run is ready, inspect its work and review threads. **Review publication** shows the
exact revision being approved. **Publish pull request** publishes that reviewed revision
and opens a PR. If the revision changes, it must be checked again. Publishing does not
merge the change.

## Measure useful outcomes

Use **Results** to record accepted, failed, or abandoned work and update its measurements.
Record actual human effort, rework, and a baseline for comparable work. Include supervision and
review in human minutes; put rework in its separate field. Leave unknown measurements blank.

Minutes saved compare recorded effort with your baseline. They are estimates, not a controlled
experiment. Compare similar tasks and workflow versions. Acceptance is a human judgment, not
merely the agent finishing a turn or opening a pull request.

Actual attributable AI cost and API-equivalent estimates are shown separately. A token-price
estimate is not your subscription bill. Maintenance costs and missing samples remain visible;
the workspace does not claim a financial return from incomplete data. An empty chart means
there is no recorded evidence yet.
