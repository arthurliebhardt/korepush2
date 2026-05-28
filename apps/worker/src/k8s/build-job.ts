import { posix } from "node:path";
import type { Apis } from "./client.js";
import { commonLabels, type LabelInput } from "@korepush/shared";
import { isAlreadyExists, isNotFound } from "./apply.js";

export interface BuildJobArgs {
  namespace: string;
  name: string;
  /** BuildKit image — recommend moby/buildkit:rootless. */
  image: string;
  gitRepoUrl: string;
  gitRef: string;
  commitSha?: string;
  /** Dockerfile path relative to repo root, e.g. apps/api/Dockerfile or Dockerfile.prod. */
  dockerfilePath: string;
  /** Build context path relative to repo root, e.g. apps/api or "." */
  buildContext: string;
  /** Fully qualified image destinations to push, e.g. ["host/proj:tag"]. */
  imageDestinations: string[];
  /** True when pushing to a plain-HTTP registry (internal in-cluster one). */
  registryInsecure?: boolean;
  labels: LabelInput;
  /** Optional Secret with a docker-config.json key for registry auth. */
  registrySecretName?: string;
  /**
   * Optional Secret with a Git access token under key `token`. When set, the
   * init container injects it into the clone URL as
   * `https://x-access-token:<token>@github.com/...`, enabling private clones.
   */
  gitTokenSecretName?: string;
}

const WORKSPACE = "/workspace";
const REPO_DIR = `${WORKSPACE}/repo`;

export function buildJobManifest(args: BuildJobArgs) {
  const labels = commonLabels(args.labels);

  const dockerfileDir = posix.dirname(args.dockerfilePath);
  const dockerfileName = posix.basename(args.dockerfilePath);
  const contextDir = args.buildContext === "." ? "" : args.buildContext;

  const absContext = posix.join(REPO_DIR, contextDir);
  const absDockerfileDir = posix.join(REPO_DIR, dockerfileDir === "." ? "" : dockerfileDir);

  // The init container clones the repo. When gitTokenSecretName is set, the
  // GIT_TOKEN env var is injected from the Secret; the script then rewrites
  // the URL to authenticate with x-access-token. URL rewriting happens in
  // pure bash (no exec) so the token never appears in `ps`.
  type EnvVar = {
    name: string;
    value?: string;
    valueFrom?: { secretKeyRef: { name: string; key: string } };
  };
  const initEnv: EnvVar[] = [];
  if (args.gitTokenSecretName) {
    initEnv.push({
      name: "GIT_TOKEN",
      valueFrom: {
        secretKeyRef: { name: args.gitTokenSecretName, key: "token" },
      },
    });
  }

  const cloneScript = [
    `set -eu`,
    `mkdir -p ${REPO_DIR}`,
    `cd ${REPO_DIR}`,
    `URL="${escapeShell(args.gitRepoUrl)}"`,
    // Inject token into HTTPS URLs only. SSH URLs would need a deploy key
    // (not implemented yet).
    `if [ -n "\${GIT_TOKEN:-}" ] && [ "\${URL#https://}" != "\$URL" ]; then`,
    `  URL="https://x-access-token:\${GIT_TOKEN}@\${URL#https://}"`,
    `fi`,
    `git init -q`,
    `git remote add origin "\$URL"`,
    `git fetch --depth 50 origin "${escapeShell(args.gitRef)}"`,
    args.commitSha
      ? `git checkout -q "${escapeShell(args.commitSha)}"`
      : `git checkout -q FETCH_HEAD`,
  ].join("\n");

  type InitContainer = {
    name: string;
    image: string;
    command: string[];
    args: string[];
    env: typeof initEnv;
    volumeMounts: Array<{ name: string; mountPath: string }>;
  };
  const initContainers: InitContainer[] = [
    {
      name: "git-clone",
      image: "alpine/git:2.45.2",
      command: ["/bin/sh", "-c"],
      args: [cloneScript],
      env: initEnv,
      volumeMounts: [{ name: "workspace", mountPath: WORKSPACE }],
    },
  ];

  // Build the BuildKit `--output` spec. Multiple destinations are encoded as
  // a comma-separated `name=` list inside the same output, with `push=true`.
  const outputSpec = [
    "type=image",
    `name=${args.imageDestinations.join(",")}`,
    "push=true",
    ...(args.registryInsecure ? ["registry.insecure=true"] : []),
  ].join(",");

  const buildctlArgs = [
    "build",
    "--frontend", "dockerfile.v0",
    "--local", `context=${absContext}`,
    "--local", `dockerfile=${absDockerfileDir}`,
    "--opt", `filename=${dockerfileName}`,
    "--output", outputSpec,
    "--progress", "plain",
  ];

  type Volume = {
    name: string;
    emptyDir?: Record<string, unknown>;
    secret?: { secretName: string; items?: Array<{ key: string; path: string }> };
  };
  type VolumeMount = { name: string; mountPath: string };

  const volumes: Volume[] = [{ name: "workspace", emptyDir: {} }];
  const builderMounts: VolumeMount[] = [{ name: "workspace", mountPath: WORKSPACE }];

  if (args.registrySecretName) {
    volumes.push({
      name: "docker-config",
      secret: {
        secretName: args.registrySecretName,
        items: [{ key: ".dockerconfigjson", path: "config.json" }],
      },
    });
    // Rootless BuildKit runs as uid 1000 with HOME=/home/user.
    builderMounts.push({ name: "docker-config", mountPath: "/home/user/.docker" });
  }

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: args.name, namespace: args.namespace, labels },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 1800,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: "Never",
          // Rootless BuildKit runs as uid 1000. The init container runs as the
          // same user, so the cloned files are already owned by 1000; fsGroup
          // makes the shared workspace volume group-accessible to the builder.
          securityContext: {
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
          },
          initContainers,
          containers: [
            {
              name: "builder",
              image: args.image,
              // buildctl-daemonless.sh spawns buildkitd, runs the command, then
              // tears it down — perfect for a one-shot Job.
              command: ["buildctl-daemonless.sh"],
              args: buildctlArgs,
              env: [
                // Force the OCI worker; the containerd worker isn't available
                // in rootless mode.
                { name: "BUILDKITD_FLAGS", value: "--oci-worker-no-process-sandbox" },
              ],
              securityContext: {
                // Rootless BuildKit needs unconfined seccomp to set up user
                // namespaces, and privilege escalation must stay enabled: the
                // setuid newuidmap/newgidmap helpers map subordinate UIDs, and
                // allowPrivilegeEscalation:false would set no_new_privs and
                // break them ("newuidmap: Could not set caps").
                seccompProfile: { type: "Unconfined" },
                runAsUser: 1000,
                runAsGroup: 1000,
              },
              volumeMounts: builderMounts,
            },
          ],
          volumes,
        },
      },
    },
  };
}

export async function createBuildJob(apis: Apis, manifest: ReturnType<typeof buildJobManifest>) {
  try {
    await apis.batch.createNamespacedJob({
      namespace: manifest.metadata.namespace,
      body: manifest,
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
}

export interface JobStatus {
  active: number;
  succeeded: number;
  failed: number;
  done: boolean;
  failureReason?: string;
}

export async function readJobStatus(
  apis: Apis,
  namespace: string,
  name: string,
): Promise<JobStatus> {
  const job = await apis.batch.readNamespacedJob({ namespace, name });
  const s = job.status ?? {};
  const failedCond = s.conditions?.find((c) => c.type === "Failed" && c.status === "True");
  const succeededCond = s.conditions?.find((c) => c.type === "Complete" && c.status === "True");
  return {
    active: s.active ?? 0,
    succeeded: s.succeeded ?? 0,
    failed: s.failed ?? 0,
    done: Boolean(succeededCond) || Boolean(failedCond),
    failureReason: failedCond?.reason ?? failedCond?.message,
  };
}

export async function deleteBuildJob(apis: Apis, namespace: string, name: string): Promise<void> {
  try {
    await apis.batch.deleteNamespacedJob({
      namespace,
      name,
      propagationPolicy: "Background",
    });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

function escapeShell(s: string): string {
  return s.replace(/(["\\$`])/g, "\\$1");
}
