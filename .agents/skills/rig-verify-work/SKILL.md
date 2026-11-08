---
name: rig-verify-work
description: Reuse repo-specific test and local setup steps when verifying a change in a Rig repository. Use when selecting checks, reproducing a test failure, or independently reviewing a ticket.
---

# Verify work in a Rig repository

1. Read the instructions and test entry points for the changed area. If `memorywell_retrieve` is available, query `testing/how-to-verify` for the current project with role `verifier` and limit 2. Use a matching repository note as a lead and check its sources in the current checkout. With a standalone CLI, use the repository instructions and CI definitions.
2. Run the smallest check that could fail for the change, then any broader checks the repo requires. Use an isolated environment for integration or browser checks. Distinguish a product failure from a check that could not run. Report the commands and their actual outcomes alongside any remaining gaps.
3. If you confirmed a setup detail, test entry point, or recurring pitfall that took real effort to find, use `memorywell_propose` with reason `convention` or `pitfall` and topic `testing/how-to-verify`. Include one to four repo-relative sources and the reproducible steps in at most 1,600 characters. Carry forward still-valid steps from the current recipe. Skip capture when the saved recipe already covers what you learned.
