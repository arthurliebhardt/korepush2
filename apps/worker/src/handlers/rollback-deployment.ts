import { eq } from "drizzle-orm";
import { schema } from "@korepush/db";
import {
  ROLLOUT_TIMEOUT_SECONDS,
  deploymentName,
  envSecretName,
  type RollbackDeploymentPayload,
  type LabelInput,
} from "@korepush/shared";
import { db } from "../db.js";
import { apis } from "../k8s/client.js";
import { applyDeployment, buildDeploymentManifest, patchDeploymentImage } from "../k8s/deployment.js";
import { waitForRollout } from "../k8s/rollout.js";
import { recordEvent, setStatus, updateDeployment } from "../deployment-store.js";

export async function rollbackDeployment(payload: RollbackDeploymentPayload): Promise<void> {
  // The "new" rollback deployment row was already created by the API; we update it.
  const newDep = await db.query.deployments.findFirst({
    where: eq(schema.deployments.id, payload.newDeploymentId),
  });
  if (!newDep) throw new Error(`new rollback deployment ${payload.newDeploymentId} not found`);

  const target = await db.query.deployments.findFirst({
    where: eq(schema.deployments.id, payload.targetDeploymentId),
  });
  if (!target) throw new Error(`target deployment ${payload.targetDeploymentId} not found`);
  if (target.status !== "ready") throw new Error(`target deployment is not ready`);

  const image = target.imageDigest
    ? `${target.imageRepository}@${target.imageDigest}`
    : `${target.imageRepository}:${target.imageTag}`;
  if (!target.imageRepository || (!target.imageDigest && !target.imageTag)) {
    throw new Error("target deployment has no image to redeploy");
  }

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, newDep.projectId),
  });
  if (!project) throw new Error(`project ${newDep.projectId} not found`);

  const environment = await db.query.environments.findFirst({
    where: eq(schema.environments.id, newDep.environmentId),
  });
  if (!environment) throw new Error(`environment ${newDep.environmentId} not found`);

  await setStatus(db, newDep.id, "deploying");
  await recordEvent(db, newDep.id, "rollback.started", `Rolling back to ${image}`);

  const k = apis();
  const depName = deploymentName(project.slug);

  const patched = await patchDeploymentImage(k, {
    namespace: environment.namespace,
    name: depName,
    image,
  }).catch(() => false);

  if (!patched) {
    // Deployment was deleted (probably after project cleanup). Recreate it.
    const labels: LabelInput = {
      projectId: project.id,
      projectSlug: project.slug,
      environmentId: environment.id,
      environmentSlug: environment.slug,
      deploymentId: newDep.id,
      component: "web",
    };
    const manifest = buildDeploymentManifest({
      namespace: environment.namespace,
      name: depName,
      image,
      port: project.port,
      envSecretName: envSecretName(project.slug),
      labels,
    });
    await applyDeployment(k, manifest);
  }

  const rollout = await waitForRollout(k, {
    namespace: environment.namespace,
    name: depName,
    timeoutSeconds: ROLLOUT_TIMEOUT_SECONDS,
  });

  if (!rollout.ready) {
    await setStatus(db, newDep.id, "failed", { failureReason: rollout.reason ?? "rollout failed" });
    await recordEvent(db, newDep.id, "rollback.failed", rollout.reason ?? "rollout failed");
    throw new Error(rollout.reason ?? "rollback rollout failed");
  }

  await setStatus(db, newDep.id, "ready");
  await updateDeployment(db, newDep.id, {
    imageRepository: target.imageRepository,
    imageTag: target.imageTag,
    imageDigest: target.imageDigest,
  });
  await recordEvent(db, newDep.id, "rollback.ready", `Rolled back to ${image}`);

  // Also flag the target's most recent superseded ones — informational only.
  await db
    .update(schema.deployments)
    .set({ status: "rolled_back", updatedAt: new Date() })
    .where(eq(schema.deployments.id, target.id));
}
