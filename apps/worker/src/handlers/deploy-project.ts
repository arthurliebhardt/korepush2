import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@korepush/db";
import { decrypt } from "@korepush/crypto";
import {
  BUILD_TIMEOUT_SECONDS,
  ROLLOUT_TIMEOUT_SECONDS,
  buildJobName,
  commonLabels,
  deploymentName,
  envSecretName,
  imageRepository,
  imageTag,
  ingressName,
  namespaceName,
  serviceName,
  validateBuildContext,
  validateDockerfilePath,
  type DeployProjectPayload,
  type LabelInput,
} from "@korepush/shared";
import { env } from "../env.js";
import { db } from "../db.js";
import { apis } from "../k8s/client.js";
import { ensureNamespace } from "../k8s/namespace.js";
import { applyEnvSecret } from "../k8s/secret.js";
import {
  applyDeployment,
  buildDeploymentManifest,
} from "../k8s/deployment.js";
import { applyService, buildServiceManifest } from "../k8s/service.js";
import { applyIngress, buildIngressManifest } from "../k8s/ingress.js";
import {
  buildJobManifest,
  createBuildJob,
  deleteBuildJob,
  readJobStatus,
} from "../k8s/build-job.js";
import { collectJobLogs } from "../k8s/logs.js";
import { waitForRollout } from "../k8s/rollout.js";
import { trackResource } from "../k8s/apply.js";
import {
  appendBuildLogs,
  recordEvent,
  setStatus,
  updateDeployment,
} from "../deployment-store.js";
import { log as rootLog } from "../log.js";

export async function deployProject(payload: DeployProjectPayload): Promise<void> {
  const log = rootLog.child({ handler: "deploy.project", deploymentId: payload.deploymentId });

  // 1. Load all the context we'll need.
  const deployment = await db.query.deployments.findFirst({
    where: eq(schema.deployments.id, payload.deploymentId),
  });
  if (!deployment) throw new Error(`deployment ${payload.deploymentId} not found`);

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, deployment.projectId),
  });
  if (!project) throw new Error(`project ${deployment.projectId} not found`);

  const environment = await db.query.environments.findFirst({
    where: eq(schema.environments.id, deployment.environmentId),
  });
  if (!environment) throw new Error(`environment ${deployment.environmentId} not found`);

  const cluster = await db.query.clusters.findFirst({
    where: eq(schema.clusters.id, project.clusterId),
  });
  if (!cluster) throw new Error(`cluster ${project.clusterId} not found`);

  await setStatus(db, deployment.id, "building");
  await recordEvent(db, deployment.id, "build.started", `Building from ${project.gitRepoUrl}`);

  // 2. Validate paths defensively before kicking off the build.
  let dockerfilePath: string;
  let buildContext: string;
  try {
    dockerfilePath = validateDockerfilePath(deployment.dockerfilePath);
    buildContext = validateBuildContext(deployment.buildContext);
  } catch (err) {
    await failDeployment(deployment.id, "build.validate_failed", String(err));
    throw err;
  }

  const labels: LabelInput = {
    projectId: project.id,
    projectSlug: project.slug,
    environmentId: environment.id,
    environmentSlug: environment.slug,
    deploymentId: deployment.id,
    component: "web",
  };
  const buildLabels: LabelInput = { ...labels, component: "build" };

  const k = apis();
  const namespace = environment.namespace || namespaceName({
    projectSlug: project.slug,
    environmentSlug: environment.slug,
  });

  // 3. Ensure namespace exists.
  await ensureNamespace(k, namespace, labels);
  await trackResource(
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: namespace, namespace: namespace, labels: commonLabelsObject(labels) },
    },
    { db, clusterId: cluster.id, projectId: project.id, environmentId: environment.id, deploymentId: deployment.id },
  );

  // 4. Run the build Job and wait for it.
  const imageRepo = imageRepository(env.registryUrl, project.slug);
  const tag = imageTag(deployment.id);
  const fullImage = `${imageRepo}:${tag}`;
  const jobName = buildJobName(deployment.id);

  const manifest = buildJobManifest({
    namespace,
    name: jobName,
    image: env.buildImage,
    gitRepoUrl: project.gitRepoUrl,
    gitRef: deployment.gitRef ?? project.gitDefaultBranch,
    commitSha: deployment.commitSha ?? undefined,
    dockerfilePath,
    buildContext,
    imageDestinations: [fullImage],
    registryInsecure: env.registryUrl.includes(".svc.cluster.local"),
    labels: buildLabels,
  });
  await createBuildJob(k, manifest);
  await trackResource(manifest as never, {
    db,
    clusterId: cluster.id,
    projectId: project.id,
    environmentId: environment.id,
    deploymentId: deployment.id,
  });
  await recordEvent(db, deployment.id, "build.job_created", `Job ${jobName} created in ${namespace}`);

  const jobStatus = await pollJob(namespace, jobName, BUILD_TIMEOUT_SECONDS, async () => {
    const text = await collectJobLogs(k, { namespace, jobName, tailLines: 200 });
    if (text) await appendBuildLogs(db, deployment.id, text);
  });

  // Final log dump after the job terminates.
  try {
    const finalLogs = await collectJobLogs(k, { namespace, jobName });
    if (finalLogs) await appendBuildLogs(db, deployment.id, finalLogs);
  } catch (err) {
    log.warn({ err: String(err) }, "failed to collect final build logs");
  }

  if (!jobStatus.done || jobStatus.failed > 0) {
    const reason = jobStatus.failureReason ?? "build failed";
    await failDeployment(deployment.id, "build.failed", reason);
    await deleteBuildJob(k, namespace, jobName).catch(() => undefined);
    throw new Error(reason);
  }

  await recordEvent(db, deployment.id, "build.succeeded", `Image ${fullImage} built`);
  await updateDeployment(db, deployment.id, {
    imageRepository: imageRepo,
    imageTag: tag,
    buildFinishedAt: new Date(),
  });

  // 5. Apply env Secret.
  await setStatus(db, deployment.id, "deploying");
  const envValues = await loadDecryptedEnv(db, environment.id);
  const secretName = envSecretName(project.slug);
  await applyEnvSecret(k, {
    namespace,
    name: secretName,
    data: envValues,
    labels,
  });
  await trackResource(
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: secretName, namespace, labels: commonLabelsObject(labels) },
      type: "Opaque",
    },
    { db, clusterId: cluster.id, projectId: project.id, environmentId: environment.id, deploymentId: deployment.id },
  );
  await recordEvent(db, deployment.id, "env.secret_applied", `${secretName} (${Object.keys(envValues).length} vars)`);

  // 6. Apply Deployment / Service / Ingress.
  const depName = deploymentName(project.slug);
  const svcName = serviceName(project.slug);
  const ingName = ingressName(project.slug);

  const depManifest = buildDeploymentManifest({
    namespace,
    name: depName,
    image: fullImage,
    port: project.port,
    envSecretName: secretName,
    labels,
  });
  await applyDeployment(k, depManifest);
  await trackResource(depManifest as never, {
    db,
    clusterId: cluster.id,
    projectId: project.id,
    environmentId: environment.id,
    deploymentId: deployment.id,
  });

  const svcManifest = buildServiceManifest({
    namespace,
    name: svcName,
    port: project.port,
    labels,
  });
  await applyService(k, svcManifest);
  await trackResource(svcManifest as never, {
    db,
    clusterId: cluster.id,
    projectId: project.id,
    environmentId: environment.id,
    deploymentId: deployment.id,
  });

  // Ingress only if domains exist.
  const domains = await db.query.domains.findMany({
    where: eq(schema.domains.environmentId, environment.id),
  });
  const hostnames = domains.map((d) => d.hostname);
  if (hostnames.length > 0) {
    const ingManifest = buildIngressManifest({
      namespace,
      name: ingName,
      serviceName: svcName,
      hostnames,
      ingressClass: cluster.defaultIngressClass,
      certIssuer: env.certIssuer,
      labels,
    });
    await applyIngress(k, ingManifest);
    await trackResource(ingManifest as never, {
      db,
      clusterId: cluster.id,
      projectId: project.id,
      environmentId: environment.id,
      deploymentId: deployment.id,
    });
  }

  await recordEvent(db, deployment.id, "rollout.started", `Waiting for rollout of ${depName}`);

  // 7. Wait for rollout.
  const rollout = await waitForRollout(k, {
    namespace,
    name: depName,
    timeoutSeconds: ROLLOUT_TIMEOUT_SECONDS,
  });

  if (!rollout.ready) {
    await failDeployment(
      deployment.id,
      "rollout.failed",
      rollout.reason ?? "rollout did not complete",
    );
    throw new Error(rollout.reason ?? "rollout failed");
  }

  await setStatus(db, deployment.id, "ready");
  await recordEvent(db, deployment.id, "deployment.ready", `Ready (${rollout.readyReplicas}/${rollout.desiredReplicas} replicas)`);

  // Mark older successful deployments as superseded? — not required for MVP.
}

async function pollJob(
  namespace: string,
  name: string,
  timeoutSeconds: number,
  onTick: () => Promise<void>,
) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const status = await readJobStatus(apis(), namespace, name);
    await onTick().catch(() => undefined);
    if (status.done) return status;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { active: 0, succeeded: 0, failed: 1, done: true, failureReason: "build timed out" };
}

async function loadDecryptedEnv(db: Database, environmentId: string): Promise<Record<string, string>> {
  const rows = await db.query.envVars.findMany({
    where: eq(schema.envVars.environmentId, environmentId),
  });
  const out: Record<string, string> = {};
  for (const row of rows) {
    try {
      out[row.key] = decrypt(row.valueEncrypted, env.encryptionKey);
    } catch {
      // Skip values that can't be decrypted (key rotation or corruption).
    }
  }
  return out;
}

async function failDeployment(deploymentId: string, eventType: string, reason: string) {
  await setStatus(db, deploymentId, "failed", { failureReason: reason });
  await recordEvent(db, deploymentId, eventType, reason);
}

function commonLabelsObject(input: LabelInput): Record<string, string> {
  return commonLabels(input);
}
// Make sure typing requires the imported `and` is not removed.
void and;
