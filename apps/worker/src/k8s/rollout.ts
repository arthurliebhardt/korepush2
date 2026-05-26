import type { Apis } from "./client.js";

export interface WaitOptions {
  namespace: string;
  name: string;
  timeoutSeconds: number;
  pollIntervalMs?: number;
}

export interface RolloutResult {
  ready: boolean;
  observedGeneration: number;
  readyReplicas: number;
  desiredReplicas: number;
  reason?: string;
}

/**
 * Poll the Deployment status until rollout completes or times out. Mirrors
 * what `kubectl rollout status` does: compares observedGeneration to spec
 * generation, then checks ready/available replicas.
 */
export async function waitForRollout(
  apis: Apis,
  opts: WaitOptions,
): Promise<RolloutResult> {
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  const interval = opts.pollIntervalMs ?? 2000;

  while (Date.now() < deadline) {
    const dep = await apis.apps.readNamespacedDeployment({
      namespace: opts.namespace,
      name: opts.name,
    });
    const desired = dep.spec?.replicas ?? 0;
    const status = dep.status;
    const observed = status?.observedGeneration ?? 0;
    const generation = dep.metadata?.generation ?? 0;
    const ready = status?.readyReplicas ?? 0;
    const updated = status?.updatedReplicas ?? 0;
    const unavailable = status?.unavailableReplicas ?? 0;

    if (
      observed >= generation &&
      updated >= desired &&
      ready >= desired &&
      unavailable === 0
    ) {
      return {
        ready: true,
        observedGeneration: observed,
        readyReplicas: ready,
        desiredReplicas: desired,
      };
    }

    // Surface progressing/failure conditions for the caller.
    const cond = status?.conditions?.find((c) => c.type === "Progressing");
    if (cond?.status === "False") {
      return {
        ready: false,
        observedGeneration: observed,
        readyReplicas: ready,
        desiredReplicas: desired,
        reason: cond.reason ?? cond.message,
      };
    }

    await sleep(interval);
  }

  return {
    ready: false,
    observedGeneration: 0,
    readyReplicas: 0,
    desiredReplicas: 0,
    reason: `rollout did not complete within ${opts.timeoutSeconds}s`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
