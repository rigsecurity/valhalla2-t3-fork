import type { ValhallaSnapshot } from "@rig/valhalla2/contracts";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { TicketsPanel } from "./TicketsPanel";

it("publishes only after confirming the exact reviewed revision", async () => {
  const reviewedHeadSha = "a".repeat(40);
  const snapshot: ValhallaSnapshot = {
    profiles: [],
    selectedProfileId: "ticket",
    memory: [],
    outcomes: [],
    policy: { memoryRequired: true, measurementRequired: true, isolatedWorktrees: true },
    health: {
      jiraConfigured: false,
      memory: "ready",
      sharedEndpoint: null,
      availableSkills: [],
      missingSkills: [],
    },
    roi: {
      started: 0,
      accepted: 0,
      failed: 0,
      abandoned: 0,
      running: 0,
      acceptanceRate: null,
      measuredAccepted: 0,
      humanMinutes: null,
      baselineMinutes: null,
      savedMinutes: null,
      actualCostUsd: null,
      estimatedCostUsd: null,
      maintenanceCostUsd: null,
      costSamples: 0,
      estimatedCostSamples: 0,
      defects: null,
      trend: [],
    },
    runs: [
      {
        id: "run-1",
        ownerId: "owner-1",
        requestId: "request-1",
        ticket: {
          key: "RD-123",
          title: "Fix the retry",
          description: "Bound retries",
          url: "https://example.atlassian.net/browse/RD-123",
          status: "In progress",
          updatedAt: "2026-11-08T00:00:00Z",
        },
        projectId: "project-1",
        repository: "github.com/example/api",
        profileId: "ticket",
        baseRef: "main",
        branch: "feat/rd-123",
        threadId: "thread-1",
        reviewerThreadId: null,
        stepRunId: null,
        worktreePath: "/workspace/rd-123",
        stage: "review",
        status: "ready_to_publish",
        planner: null,
        implementer: { provider: "claude", model: "sonnet" },
        reviewer: null,
        skills: [],
        optionalTools: [],
        maxRepairAttempts: 1,
        repairAttempts: 0,
        deliveryAttempts: 1,
        startedAt: "2026-11-08T00:00:00Z",
        updatedAt: "2026-11-08T00:00:00Z",
        completedAt: null,
        reviewedHeadSha,
        prUrl: null,
        error: null,
      },
    ],
  };
  const command = vi.fn(async () => ({ published: true }));
  await using screen = await render(
    <TicketsPanel
      snapshot={snapshot}
      environmentId={EnvironmentId.make("test-environment")}
      projects={[]}
      onCommand={command}
      busy={false}
      canPublish
    />,
  );

  await screen.getByRole("button", { name: "Review publication" }).click();
  await expect.element(screen.getByText(reviewedHeadSha)).toBeVisible();
  expect(command).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Publish pull request" }))
    .not.toBeInTheDocument();
  expect(command).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Review publication" }).click();
  await screen.getByRole("button", { name: "Publish pull request" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Publish pull request" }))
    .not.toBeInTheDocument();
  expect(command).toHaveBeenCalledExactlyOnceWith({
    type: "ticket.publish",
    id: "run-1",
    approvedHeadSha: reviewedHeadSha,
  });
});
