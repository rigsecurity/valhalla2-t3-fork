import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useContext, useEffect } from "react";

import { agentSessionScan } from "../state/agentSessions";
import { environmentAtomList, environmentIdsKey } from "../state/environmentAtomList";
import { formatEnvironmentQueryError } from "../state/query";

const scanAtom = (environmentId: EnvironmentId) => agentSessionScan({ environmentId, input: {} });
const projectScansAtom = environmentAtomList("web-project-scans", scanAtom);

export function useProjectScans(
  environmentIds: readonly EnvironmentId[],
  { refreshCached = false }: { readonly refreshCached?: boolean } = {},
) {
  const registry = useContext(RegistryContext);
  const key = environmentIdsKey(environmentIds);
  const results = useAtomValue(projectScansAtom(key));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Native transcripts can change while the import dialog is closed.
  useEffect(() => {
    if (!refreshCached || key === "") return;
    for (const environmentId of key.split("\n") as EnvironmentId[]) {
      const atom = scanAtom(environmentId);
      const result = registry.get(atom);
      if (result._tag !== "Initial" && !result.waiting) registry.refresh(atom);
    }
  }, [key, refreshCached, registry]);
  return environmentIds.map((environmentId, index) => {
    const result = results[index]!;
    return {
      environmentId,
      data: refreshCached && result.waiting ? null : AsyncResult.getOrElse(result, () => null),
      error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
      isPending: result.waiting || result._tag === "Initial",
      refresh: () => registry.refresh(scanAtom(environmentId)),
    };
  });
}
