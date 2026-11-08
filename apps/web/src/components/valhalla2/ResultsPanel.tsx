import { randomUUID } from "../../lib/utils";
import type { OutcomeEntry, ValhallaSnapshot } from "@rig/valhalla2/contracts";
import { useState } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Choice,
  EmptyState,
  Field,
  NumberField,
  Panel,
  type WorkspaceCommand,
} from "./WorkspaceParts";

const number = (value: number | null) =>
  value === null
    ? "Not measured"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const money = (value: number | null) =>
  value === null
    ? "Not recorded"
    : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);
const nullableNumber = (value: string) => (value.trim() ? Number(value) : null);

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function OutcomeForm({
  snapshot,
  initial,
  onCommand,
  busy,
  onClose,
}: {
  snapshot: ValhallaSnapshot;
  initial: OutcomeEntry | null;
  onCommand: WorkspaceCommand;
  busy: boolean;
  onClose: () => void;
}) {
  const [repository, setRepository] = useState(initial?.repository ?? "");
  const [ticketKey, setTicketKey] = useState(initial?.ticketKey ?? "");
  const [profileId, setProfileId] = useState(initial?.profileId ?? snapshot.selectedProfileId);
  const [status, setStatus] = useState(initial?.status ?? "accepted");
  const [baseline, setBaseline] = useState(initial?.baselineMinutes?.toString() ?? "");
  const [human, setHuman] = useState(initial?.humanMinutes?.toString() ?? "");
  const [rework, setRework] = useState(initial?.reworkMinutes?.toString() ?? "");
  const [cost, setCost] = useState(initial?.actualCostUsd?.toString() ?? "");
  const [maintenance, setMaintenance] = useState(initial?.maintenanceCostUsd?.toString() ?? "");
  const [defects, setDefects] = useState(initial?.defects?.toString() ?? "");
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const profile = snapshot.profiles.find((item) => item.id === profileId);
        if (!profile) return;
        const now = new Date().toISOString();
        const result = await onCommand({
          type: "outcome.record",
          input: {
            ...(initial
              ? {
                  id: initial.id,
                  startedAt: initial.startedAt,
                  workflowVersion: initial.workflowVersion,
                  model: initial.model,
                  ...(initial.memoryVersion ? { memoryVersion: initial.memoryVersion } : {}),
                  ...(initial.prUrl ? { prUrl: initial.prUrl } : {}),
                  ...(initial.estimatedCostUsd !== undefined
                    ? { estimatedCostUsd: initial.estimatedCostUsd }
                    : {}),
                }
              : {
                  startedAt: now,
                  model: `${profile.implementer.provider}/${profile.implementer.model}`,
                }),
            idempotencyKey: randomUUID(),
            repository: repository.trim(),
            ...(ticketKey.trim() ? { ticketKey: ticketKey.trim() } : {}),
            profileId,
            status,
            ...(status === "running" ? {} : { completedAt: initial?.completedAt ?? now }),
            baselineMinutes: nullableNumber(baseline),
            humanMinutes: nullableNumber(human),
            reworkMinutes: nullableNumber(rework),
            actualCostUsd: nullableNumber(cost),
            maintenanceCostUsd: nullableNumber(maintenance),
            defects: nullableNumber(defects),
          },
        });
        if (result !== null) onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Repository">
          <Input
            required
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder="github.com/rigsecurity/api"
          />
        </Field>
        <Field label="Ticket (optional)">
          <Input
            value={ticketKey}
            onChange={(event) => setTicketKey(event.target.value)}
            placeholder="RD-1234"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Workflow">
          <Choice
            label="Outcome workflow"
            value={profileId}
            onChange={setProfileId}
            options={snapshot.profiles.map((profile) => ({
              value: profile.id,
              label: profile.name,
            }))}
          />
        </Field>
        <Field label="Outcome">
          <Choice
            label="Outcome status"
            value={status}
            onChange={(value) => {
              if (
                value === "accepted" ||
                value === "failed" ||
                value === "abandoned" ||
                value === "running"
              )
                setStatus(value);
            }}
            options={[
              { value: "accepted", label: "Accepted by an engineer" },
              { value: "failed", label: "Failed" },
              { value: "abandoned", label: "Abandoned" },
              { value: "running", label: "Still running" },
            ]}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Baseline human minutes"
          value={baseline}
          onChange={setBaseline}
          hint="Expected human effort for comparable work without this workflow."
        />
        <NumberField
          label="Human minutes spent"
          value={human}
          onChange={setHuman}
          hint="Include supervision and review. Record rework separately below."
        />
        <NumberField label="Rework minutes" value={rework} onChange={setRework} />
        <NumberField
          label="Actual AI cost (USD)"
          value={cost}
          onChange={setCost}
          hint="Only an attributable billed cost. Leave blank when unknown."
        />
        <NumberField label="Maintenance cost (USD)" value={maintenance} onChange={setMaintenance} />
        <NumberField label="Defects found" value={defects} onChange={setDefects} step={1} />
      </div>
      <p className="text-xs text-muted-foreground">
        Blank means unknown. Time saved is an estimate against your baseline; usage prices alone do
        not establish a financial return.
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Save measurement
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ResultsPanel({
  snapshot,
  onCommand,
  busy,
}: {
  snapshot: ValhallaSnapshot;
  onCommand: WorkspaceCommand;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<OutcomeEntry | "new" | null>(null);
  const { roi } = snapshot;
  const maxCount = Math.max(
    1,
    ...roi.trend.map((day) => day.accepted + day.failed + day.abandoned),
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Accepted work"
          value={String(roi.accepted)}
          detail={`${roi.started} recorded attempts · ${roi.running} still running`}
        />
        <Metric
          label="Acceptance rate"
          value={
            roi.acceptanceRate === null ? "Not measured" : `${number(roi.acceptanceRate * 100)}%`
          }
          detail={`${roi.failed} failed · ${roi.abandoned} abandoned`}
        />
        <Metric
          label="Estimated minutes saved"
          value={number(roi.savedMinutes)}
          detail={`${roi.measuredAccepted} accepted outcomes with comparable effort`}
        />
        <Metric
          label="Recorded AI cost"
          value={money(roi.actualCostUsd)}
          detail={`${roi.costSamples} cost samples · excludes unknown costs`}
        />
      </div>
      <Panel
        title="Improvement over time"
        description="Recorded outcomes by day. Compare similar work and workflow versions before drawing conclusions."
        action={
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            Record an outcome
          </Button>
        }
      >
        {roi.trend.length === 0 ? (
          <EmptyState title="Your baseline starts here">
            Completed work will build this picture. Add human effort, a comparable baseline, and
            actual cost to measure whether the workflow helps.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-primary" />
                Accepted
              </span>
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-destructive" />
                Failed or abandoned
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-96 text-left text-sm">
                <caption className="sr-only">Daily outcomes and estimated minutes saved</caption>
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    <th className="py-3 font-medium">Day</th>
                    <th className="py-3 font-medium">Outcomes</th>
                    <th className="py-3 text-right font-medium">Minutes saved</th>
                  </tr>
                </thead>
                <tbody>
                  {roi.trend.map((day) => (
                    <tr key={day.date} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 text-xs">{day.date}</td>
                      <td className="w-1/2 py-3 pr-4">
                        <div
                          className="flex h-4 overflow-hidden rounded-sm bg-muted/40"
                          role="img"
                          aria-label={`${day.accepted} accepted, ${day.failed} failed, ${day.abandoned} abandoned`}
                        >
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${(day.accepted / maxCount) * 100}%` }}
                          />
                          <div
                            className="h-full bg-destructive"
                            style={{ width: `${((day.failed + day.abandoned) / maxCount) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3 text-right text-xs tabular-nums">
                        {number(day.savedMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          API-equivalent estimates: {money(roi.estimatedCostUsd)} ({roi.estimatedCostSamples}{" "}
          samples). Recorded maintenance: {money(roi.maintenanceCostUsd)}. Neither is silently
          treated as zero.
        </p>
      </Panel>
      {editing !== null && (
        <Panel title={editing === "new" ? "Record an outcome" : "Update measurement"}>
          <OutcomeForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            snapshot={snapshot}
            onCommand={onCommand}
            busy={busy}
            onClose={() => setEditing(null)}
          />
        </Panel>
      )}
      {snapshot.outcomes.length > 0 && (
        <Panel
          title="Measurement history"
          description="Correct an estimate or fill in effort and cost after review."
        >
          <div className="divide-y divide-border">
            {snapshot.outcomes.map((outcome) => (
              <div
                key={outcome.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">
                    {outcome.ticketKey || outcome.repository}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {snapshot.profiles.find(({ id }) => id === outcome.profileId)?.name ??
                      outcome.profileId}{" "}
                    · {outcome.model}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={outcome.status === "accepted" ? "success" : "secondary"}>
                    {outcome.status}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(outcome)}>
                    Measure
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
