import { eq, sql } from "drizzle-orm";
import { schema } from "@korepush/db";
import type { DeleteProjectPayload } from "@korepush/shared";
import { db } from "../db.js";
import { apis } from "../k8s/client.js";
import { isNotFound } from "../k8s/apply.js";
import { log as rootLog } from "../log.js";

export async function deleteProject(payload: DeleteProjectPayload): Promise<void> {
  const log = rootLog.child({ handler: "delete.project", projectId: payload.projectId });

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, payload.projectId),
  });
  if (!project) {
    log.warn("project not found");
    return;
  }

  const environments = await db.query.environments.findMany({
    where: eq(schema.environments.projectId, project.id),
  });

  const k = apis();
  for (const environment of environments) {
    try {
      await k.core.deleteNamespace({ name: environment.namespace });
      log.info({ namespace: environment.namespace }, "namespace delete requested");
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  // Mark managed resources as deleted in our tracker.
  await db.execute(sql`
    UPDATE k8s_resources
    SET deleted_at = now(), updated_at = now()
    WHERE project_id = ${project.id} AND deleted_at IS NULL
  `);

  // The project row is already soft-deleted by the API. Hard-delete now that
  // K8s resources are gone.
  await db.delete(schema.projects).where(eq(schema.projects.id, project.id));
  log.info("project deleted");
}
