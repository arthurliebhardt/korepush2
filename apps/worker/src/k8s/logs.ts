import type { Apis } from "./client.js";
import { isNotFound, isBadRequest } from "./apply.js";

/**
 * Stream logs from the first matching pod for a job (label selector
 * `job-name=<name>`). Calls onLine for each newline-delimited chunk and
 * resolves when the stream ends.
 *
 * MVP uses a polling approach: read logs once with `follow=false` after the
 * pod terminates. Live streaming requires raw HTTP plumbing that's brittle
 * across @kubernetes/client-node versions; polling is robust and good enough.
 */
export interface CollectOptions {
  namespace: string;
  jobName: string;
  containerName?: string;
  tailLines?: number;
}

export async function collectJobLogs(
  apis: Apis,
  opts: CollectOptions,
): Promise<string> {
  const podList = await apis.core.listNamespacedPod({
    namespace: opts.namespace,
    labelSelector: `job-name=${opts.jobName}`,
  });
  const pod = podList.items[0];
  if (!pod?.metadata?.name) return "";

  const container =
    opts.containerName ??
    pod.spec?.containers?.[0]?.name ??
    "builder";

  try {
    const text = await apis.core.readNamespacedPodLog({
      namespace: opts.namespace,
      name: pod.metadata.name,
      container,
      tailLines: opts.tailLines,
      timestamps: true,
    });
    return typeof text === "string" ? text : "";
  } catch (err) {
    // Container may not have started (e.g. an earlier init container failed) or
    // the pod may be gone. Treat as "no logs" rather than failing the deploy.
    if (isNotFound(err) || isBadRequest(err)) return "";
    throw err;
  }
}
