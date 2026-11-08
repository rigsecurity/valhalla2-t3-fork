---
name: rig-memorywell
description: Recall or save a reusable repository finding through Memorywell. Use before unfamiliar repo work and after costly research, a confirmed repo convention, or a repeatable pitfall.
---

Call `memorywell_retrieve` with the task topic and relevant paths before repeating unfamiliar research. Inside Valhalla2 the tool uses the current project. Outside it, find the matching Git remote with `t3_project_list` and pass the project's ID. Check the returned sources against the checkout before relying on a note.

Capture a finding when another engineer would otherwise repeat meaningful work. Good candidates are a hard-to-trace dependency, a test command this repo consistently requires, or a reproducible failure with a fix. Skip routine results, facts already obvious in the current docs, guesses, and details specific to this ticket.

Call `memorywell_propose` before finishing. Set `reason` to `research`, `convention`, or `pitfall`. Give it a stable topic, a short takeaway, and one to four checked references such as a repo-relative file and line, a test, or a commit. Keep the note under 1,600 characters. Leave out secrets, personal preferences, and transcripts. Reuse a request key only when retrying the same note.

Captured notes become available to future agents in the same repository. Follow checked-in repo rules and verify the note's sources before acting. Use the available work context if the service is unreachable.
