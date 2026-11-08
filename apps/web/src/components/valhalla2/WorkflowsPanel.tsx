import { randomUUID } from "../../lib/utils";
import type { ValhallaSnapshot, WorkflowProfile } from "@rig/valhalla2/contracts";
import { useState } from "react";
import { CheckIcon, PlusIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Choice, Field, NumberField, Panel, type WorkspaceCommand } from "./WorkspaceParts";

function ModelFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: WorkflowProfile["implementer"];
  onChange: (value: WorkflowProfile["implementer"]) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider">
          <Input
            required
            value={value.provider}
            onChange={(event) => onChange({ ...value, provider: event.target.value })}
            placeholder="claudeAgent"
          />
        </Field>
        <Field label="Model">
          <Input
            required
            value={value.model}
            onChange={(event) => onChange({ ...value, model: event.target.value })}
            placeholder="sonnet"
          />
        </Field>
      </div>
    </fieldset>
  );
}

function ProfileEditor({
  initial,
  onCommand,
  busy,
  onClose,
}: {
  initial: WorkflowProfile;
  onCommand: WorkspaceCommand;
  busy: boolean;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState(initial);
  const [skills, setSkills] = useState(initial.skills.join(", "));
  const [tools, setTools] = useState(initial.optionalTools.join(", "));
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await onCommand({
          type: "profile.save",
          profile: {
            ...profile,
            skills: skills
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            optionalTools: tools
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          },
        });
        if (result !== null) onClose();
      }}
    >
      <Field label="Profile name">
        <Input
          required
          value={profile.name}
          onChange={(event) => setProfile({ ...profile, name: event.target.value })}
        />
      </Field>
      <Field label="How you like to work">
        <Choice
          label="Workflow mode"
          value={profile.mode}
          onChange={(mode) => {
            if (mode === "freestyle" || mode === "skills" || mode === "ticket")
              setProfile({ ...profile, mode });
          }}
          options={[
            { value: "freestyle", label: "Freestyle" },
            { value: "skills", label: "Use my skills" },
            { value: "ticket", label: "Ticket to pull request" },
          ]}
        />
      </Field>
      <ModelFields
        label="Implementation"
        value={profile.implementer}
        onChange={(implementer) => setProfile({ ...profile, implementer })}
      />
      {profile.planner ? (
        <div className="space-y-2">
          <ModelFields
            label="Planning"
            value={profile.planner}
            onChange={(planner) => setProfile({ ...profile, planner })}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setProfile(({ planner: _planner, ...rest }) => rest)}
          >
            Remove separate planner
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setProfile({ ...profile, planner: { ...profile.implementer } })}
        >
          <PlusIcon />
          Use a separate planner
        </Button>
      )}
      {profile.reviewer ? (
        <div className="space-y-2">
          <ModelFields
            label="Review"
            value={profile.reviewer}
            onChange={(reviewer) => setProfile({ ...profile, reviewer })}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setProfile(({ reviewer: _reviewer, ...rest }) => rest)}
          >
            Remove separate reviewer
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setProfile({ ...profile, reviewer: { ...profile.implementer } })}
        >
          <PlusIcon />
          Add an independent review
        </Button>
      )}
      <Field
        label="Skills"
        hint="Comma-separated names. Use the names shown in your provider's skill picker."
      >
        <Input
          value={skills}
          onChange={(event) => setSkills(event.target.value)}
          placeholder="review, test-first"
        />
      </Field>
      <Field
        label="Optional tools"
        hint="Record your preferred tools. A tool still needs to be installed and configured on its provider."
      >
        <Input
          value={tools}
          onChange={(event) => setTools(event.target.value)}
          placeholder="local-tilt"
        />
      </Field>
      <NumberField
        label="Maximum repair attempts"
        max={3}
        step={1}
        value={String(profile.maxRepairAttempts)}
        onChange={(value) => setProfile({ ...profile, maxRepairAttempts: Number(value) })}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Save profile
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function WorkflowsPanel({
  snapshot,
  onCommand,
  busy,
}: {
  snapshot: ValhallaSnapshot;
  onCommand: WorkspaceCommand;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<WorkflowProfile | null>(null);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <Panel
        title="Your workflows"
        description="Choose how you work. Shared knowledge, measurement, and isolated work stay on."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setEditing({
                id: randomUUID(),
                name: "My workflow",
                mode: "freestyle",
                implementer: { provider: "claudeAgent", model: "sonnet" },
                skills: [],
                optionalTools: [],
                maxRepairAttempts: 2,
              })
            }
          >
            <PlusIcon />
            New profile
          </Button>
        }
      >
        <div className="space-y-3">
          {snapshot.profiles.map((profile) => (
            <article key={profile.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium text-sm">{profile.name}</h3>
                {snapshot.selectedProfileId === profile.id && (
                  <Badge variant="success">
                    <CheckIcon />
                    Selected
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {profile.mode} · {profile.implementer.provider} / {profile.implementer.model}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {profile.skills.length ? `${profile.skills.length} skills` : "No required skills"}
                {profile.planner ? " · Separate planner" : ""}
                {profile.reviewer ? " · Independent review" : ""}
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || snapshot.selectedProfileId === profile.id}
                  onClick={() => void onCommand({ type: "profile.select", id: profile.id })}
                >
                  Use profile
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(profile)}>
                  Edit
                </Button>
              </div>
            </article>
          ))}
        </div>
      </Panel>
      <Panel
        title={editing ? "Edit workflow" : "Skills and tools"}
        description={
          editing
            ? "Start with Claude and add other models when they help."
            : "Check that your selected workflow can find the skills it needs."
        }
      >
        {editing ? (
          <ProfileEditor
            key={editing.id}
            initial={editing}
            onCommand={onCommand}
            busy={busy}
            onClose={() => setEditing(null)}
          />
        ) : (
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-medium">Available skills</p>
              <p className="mt-2 text-muted-foreground">
                {snapshot.health.availableSkills.join(", ") ||
                  "No skills reported by this environment."}
              </p>
            </div>
            <div>
              <p className="font-medium">Missing from this workflow</p>
              <p className="mt-2 text-muted-foreground">
                {snapshot.health.missingSkills.join(", ") || "No missing skills reported."}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              After installing a skill or tool, restart the agent session from the command palette,
              then refresh this workspace.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
