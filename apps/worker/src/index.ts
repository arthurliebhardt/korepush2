import { runWorker, type ClaimedJob } from "@korepush/queue";
import type {
  DeleteProjectPayload,
  DeployProjectPayload,
  RollbackDeploymentPayload,
  SyncDomainPayload,
} from "@korepush/shared";
import { db } from "./db.js";
import { env } from "./env.js";
import { deployProject } from "./handlers/deploy-project.js";
import { rollbackDeployment } from "./handlers/rollback-deployment.js";
import { deleteProject } from "./handlers/delete-project.js";
import { syncDomain } from "./handlers/sync-domain.js";
import { log } from "./log.js";

async function handle(job: ClaimedJob): Promise<void> {
  log.info({ jobId: job.id, kind: job.kind, attempt: job.attempts }, "claimed job");

  switch (job.kind) {
    case "deploy.project":
      await deployProject(job.payload as DeployProjectPayload);
      return;
    case "rollback.deployment":
      await rollbackDeployment(job.payload as RollbackDeploymentPayload);
      return;
    case "delete.project":
      await deleteProject(job.payload as DeleteProjectPayload);
      return;
    case "sync.domain":
      await syncDomain(job.payload as SyncDomainPayload);
      return;
    default: {
      const _exhaustive: never = job.kind;
      throw new Error(`unknown job kind: ${String(_exhaustive)}`);
    }
  }
}

async function main() {
  log.info({ workerId: env.workerId, namespace: env.platformNamespace }, "worker starting");

  const abort = new AbortController();
  const shutdown = (sig: string) => {
    log.info({ signal: sig }, "shutting down");
    abort.abort();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await runWorker(db, {
    workerId: env.workerId,
    pollIntervalMs: 1000,
    visibilityTimeoutSeconds: 300,
    signal: abort.signal,
    handler: handle,
    onError: (job, err) => {
      log.error(
        { jobId: job.id, kind: job.kind, err: err instanceof Error ? err.stack : String(err) },
        "job handler error",
      );
    },
  });

  log.info("worker exited");
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.stack : String(err) }, "fatal");
  process.exit(1);
});
