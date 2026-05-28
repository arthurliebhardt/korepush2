# Nixpacks → BuildKit builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project build with Nixpacks (auto-generated Dockerfile) instead of requiring a committed Dockerfile, reusing the existing rootless-BuildKit build Job.

**Architecture:** A new `buildMode = "nixpacks"` on projects (snapshotted onto deployments). In that mode the build Job gains a second init container (`nixpacks-prep`, a pinned Nixpacks image published via CI) that runs after `git-clone` and writes `/workspace/repo/.nixpacks/Dockerfile`; the existing BuildKit `builder` container then builds that Dockerfile and pushes as usual. The UI/API gain an explicit Dockerfile-vs-Nixpacks toggle.

**Tech Stack:** TypeScript, Next.js (App Router) web app, Node worker using `@kubernetes/client-node`, Drizzle ORM + Postgres, Docker/BuildKit, Nixpacks, GitHub Actions, pnpm + turbo monorepo.

**Testing note:** This repo has no automated test framework, and the approved design explicitly does not introduce one. "Tests" here are: `typecheck`, an ad-hoc manifest assertion run via `tsx`, and a manual end-to-end run in the OrbStack VM. Commit frequently.

**Spec:** `docs/superpowers/specs/2026-05-28-nixpacks-buildkit-builds-design.md`

---

## File structure

- `packages/shared/src/constants.ts` — add `BUILD_MODES` const + `BuildMode` type (single source of truth for the enum).
- `packages/shared/src/index.ts` — ensure the new export is surfaced (verify; constants are re-exported).
- `packages/db/src/schema/deployments.ts` — add `buildMode` column.
- `packages/db/drizzle/*` — generated migration (via `drizzle-kit generate`).
- `apps/worker/src/env.ts` — add `nixpacksImage`.
- `apps/worker/src/k8s/build-job.ts` — `BuildJobArgs` gains `buildMode` + `nixpacksImage`; append `nixpacks-prep` init container and override the BuildKit Dockerfile args in nixpacks mode.
- `apps/worker/src/k8s/logs.ts` — collect logs from a named container that may be an init container.
- `apps/worker/src/handlers/deploy-project.ts` — pass `buildMode` + `nixpacksImage` to the manifest; collect init-container logs on failure.
- `apps/web/app/api/projects/route.ts` — accept `buildMode`; skip Dockerfile-path validation in nixpacks mode; persist `buildMode`.
- `apps/web/app/api/projects/[projectId]/route.ts` — same for PATCH.
- `apps/web/app/api/projects/[projectId]/deployments/route.ts` — snapshot `buildMode` onto the deployment row.
- `apps/web/app/dashboard/projects/new/new-project-form.tsx` — build-mode toggle.
- `apps/web/app/dashboard/projects/[projectId]/settings/settings-form.tsx` + `settings/page.tsx` — build-mode toggle.
- `docker/nixpacks/Dockerfile` — new pinned Nixpacks image.
- `.github/workflows/images.yml` — publish the nixpacks image.

---

## Task 1: Add the BuildMode enum to shared

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Verify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add the enum constant**

In `packages/shared/src/constants.ts`, add near the other exported consts:

```ts
export const BUILD_MODES = ["dockerfile", "nixpacks"] as const;
export type BuildMode = (typeof BUILD_MODES)[number];
```

- [ ] **Step 2: Confirm it is re-exported**

Run: `grep -n "constants" packages/shared/src/index.ts`
Expected: a line like `export * from "./constants.js";`. If missing, add `export * from "./constants.js";`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @korepush/shared typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/index.ts
git commit -m "shared: add BuildMode enum (dockerfile | nixpacks)"
```

---

## Task 2: Add buildMode column to deployments + migration

**Files:**
- Modify: `packages/db/src/schema/deployments.ts:36-38`
- Generate: `packages/db/drizzle/*` (new migration)

- [ ] **Step 1: Add the column to the schema**

In `packages/db/src/schema/deployments.ts`, in the `deployments` table, directly above the existing `dockerfilePath` line, add:

```ts
    // dockerfile | nixpacks — snapshot of project.buildMode at deploy time.
    buildMode: text("build_mode").notNull().default("dockerfile"),
    dockerfilePath: text("dockerfile_path").notNull(),
```

(The `dockerfilePath` line already exists; the new line is `buildMode`.)

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @korepush/db generate`
Expected: a new file under `packages/db/drizzle/` (e.g. `0001_*.sql`) containing `ALTER TABLE "deployments" ADD COLUMN "build_mode" text DEFAULT 'dockerfile' NOT NULL;`, plus an updated `packages/db/drizzle/meta/` snapshot.

- [ ] **Step 3: Inspect the generated SQL**

Run: `git status --short packages/db/drizzle && cat packages/db/drizzle/*build_mode*.sql 2>/dev/null || ls -t packages/db/drizzle/*.sql | head -1 | xargs cat`
Expected: the ALTER TABLE statement above and nothing unrelated. If the diff includes unrelated tables, stop and investigate schema drift before continuing.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @korepush/db typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/deployments.ts packages/db/drizzle
git commit -m "db: add deployments.build_mode (snapshot of project build mode)"
```

---

## Task 3: Worker env — NIXPACKS_IMAGE

**Files:**
- Modify: `apps/worker/src/env.ts:18-21`

- [ ] **Step 1: Add the env var**

In `apps/worker/src/env.ts`, directly after the `buildImage:` entry, add:

```ts
  // Nixpacks image used to generate a Dockerfile for buildMode=nixpacks
  // projects. Pinned build published by CI; overridable for air-gapped installs.
  nixpacksImage:
    process.env.NIXPACKS_IMAGE ??
    "ghcr.io/arthurliebhardt/korepush2-nixpacks:latest",
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @korepush/worker typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/env.ts
git commit -m "worker: add NIXPACKS_IMAGE env (default GHCR pinned build)"
```

---

## Task 4: build-job.ts — nixpacks prep init container + Dockerfile override

**Files:**
- Modify: `apps/worker/src/k8s/build-job.ts`

- [ ] **Step 1: Extend BuildJobArgs**

In `apps/worker/src/k8s/build-job.ts`, add to the `BuildJobArgs` interface (after `dockerfilePath`/`buildContext`):

```ts
  /** dockerfile | nixpacks. In nixpacks mode a prep init container generates
   * the Dockerfile and the user's dockerfilePath is ignored. */
  buildMode: "dockerfile" | "nixpacks";
  /** Image containing the nixpacks binary; required when buildMode=nixpacks. */
  nixpacksImage?: string;
```

- [ ] **Step 2: Add a constant for the generated Dockerfile location**

Below the existing `const REPO_DIR = ...` line, add:

```ts
const NIXPACKS_OUT_DIR = `${REPO_DIR}/.nixpacks`;
```

- [ ] **Step 3: Append the nixpacks-prep init container in nixpacks mode**

In `buildJobManifest`, after the `initContainers` array is defined (the array currently holding only `git-clone`), insert:

```ts
  if (args.buildMode === "nixpacks") {
    if (!args.nixpacksImage) {
      throw new Error("nixpacksImage is required when buildMode is nixpacks");
    }
    // Generate a Dockerfile from the cloned repo. `--out` makes nixpacks write
    // the Dockerfile + build assets without running a docker build. Runs as
    // uid 1000 (pod securityContext); repo is already 1000-owned by git-clone.
    const nixpacksScript = [
      `set -eu`,
      `cd ${REPO_DIR}`,
      `nixpacks build ${REPO_DIR} --out ${REPO_DIR}`,
      `test -f ${NIXPACKS_OUT_DIR}/Dockerfile`,
    ].join("\n");
    initContainers.push({
      name: "nixpacks-prep",
      image: args.nixpacksImage,
      command: ["/bin/sh", "-c"],
      args: [nixpacksScript],
      env: [],
      volumeMounts: [{ name: "workspace", mountPath: WORKSPACE }],
    });
  }
```

> **Verify before relying on it:** confirm `nixpacks build <path> --out <path>` writes `<path>/.nixpacks/Dockerfile` and does NOT attempt a docker build, for the pinned version from Task 7. Check `nixpacks build --help` in the built image (`docker run --rm <image> nixpacks build --help`). If the flag differs, adjust `nixpacksScript` and this note.

- [ ] **Step 4: Override the BuildKit Dockerfile args in nixpacks mode**

Find where `buildctlArgs` is built (the `--local context=...`, `--local dockerfile=...`, `--opt filename=...` block). Immediately BEFORE the `const buildctlArgs = [` line, compute the effective dockerfile location:

```ts
  // In nixpacks mode, ignore the user's dockerfilePath and build the generated
  // Dockerfile. The context stays the repo root so the generated Dockerfile's
  // relative COPYs resolve.
  const effContext = args.buildMode === "nixpacks" ? REPO_DIR : absContext;
  const effDockerfileDir =
    args.buildMode === "nixpacks" ? NIXPACKS_OUT_DIR : absDockerfileDir;
  const effDockerfileName =
    args.buildMode === "nixpacks" ? "Dockerfile" : dockerfileName;
```

Then change the three relevant entries in `buildctlArgs` to use the `eff*` values:

```ts
  const buildctlArgs = [
    "build",
    "--frontend", "dockerfile.v0",
    "--local", `context=${effContext}`,
    "--local", `dockerfile=${effDockerfileDir}`,
    "--opt", `filename=${effDockerfileName}`,
    "--output", outputSpec,
    "--progress", "plain",
  ];
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @korepush/worker typecheck`
Expected: fails — `deploy-project.ts` calls `buildJobManifest` without the now-required `buildMode`. That is fixed in Task 6. Confirm the ONLY errors are the missing `buildMode` arg at the `buildJobManifest(...)` call site.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/k8s/build-job.ts
git commit -m "worker: add nixpacks-prep init container + dockerfile override to build job"
```

---

## Task 5: logs.ts — allow collecting a specific (init) container's logs

**Files:**
- Modify: `apps/worker/src/k8s/logs.ts:31-44`

- [ ] **Step 1: Make container resolution explicit and not crash on init containers**

The current code defaults `container` to the first *main* container ("builder"). `readNamespacedPodLog` accepts any container name including init containers, so the only change needed is to allow callers to pass an init container name (already supported via `opts.containerName`) and to tolerate a not-yet-started container. Replace the `try { ... }` block body so a "container not started"/"not found" error returns `""` instead of throwing:

```ts
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
```

- [ ] **Step 2: Add the isBadRequest helper import/usage**

At the top of `logs.ts`, change the import from `./apply.js` to also bring in a bad-request check. First confirm what exists:

Run: `grep -n "isBadRequest\|isNotFound\|statusCode\|=== 400\|=== 404" apps/worker/src/k8s/apply.ts`
Expected: shows `isNotFound`. If `isBadRequest` does not exist, add it to `apps/worker/src/k8s/apply.ts` mirroring `isNotFound` but for HTTP 400:

```ts
export function isBadRequest(err: unknown): boolean {
  return hasStatusCode(err, 400);
}
```

If `isNotFound` is implemented inline (not via a shared `hasStatusCode`), copy its exact shape and swap the code to 400. Then in `logs.ts`:

```ts
import { isNotFound, isBadRequest } from "./apply.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @korepush/worker typecheck`
Expected: only the pre-existing missing-`buildMode` error from Task 4 remains; no new errors in `logs.ts`/`apply.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/k8s/logs.ts apps/worker/src/k8s/apply.ts
git commit -m "worker: tolerate unstarted/init containers when collecting build logs"
```

---

## Task 6: deploy-project.ts — pass buildMode + collect init logs on failure

**Files:**
- Modify: `apps/worker/src/handlers/deploy-project.ts:146-188`

- [ ] **Step 1: Pass buildMode + nixpacksImage into the manifest**

In the `buildJobManifest({ ... })` call (around line 146), add these two fields (e.g. after `buildContext,`):

```ts
    buildMode: deployment.buildMode as "dockerfile" | "nixpacks",
    nixpacksImage: env.nixpacksImage,
```

- [ ] **Step 2: Collect init-container logs in the failure path**

Find the failure branch (around line 183):

```ts
  if (!jobStatus.done || jobStatus.failed > 0) {
    const reason = jobStatus.failureReason ?? "build failed";
    await failDeployment(deployment.id, "build.failed", reason);
    await deleteBuildJob(k, namespace, jobName).catch(() => undefined);
    throw new Error(reason);
  }
```

Replace it with a version that pulls init-container logs first (the builder never starts when an init container fails, so these are the only logs that explain the failure):

```ts
  if (!jobStatus.done || jobStatus.failed > 0) {
    for (const initContainer of ["git-clone", "nixpacks-prep"]) {
      try {
        const initLogs = await collectJobLogs(k, {
          namespace,
          jobName,
          containerName: initContainer,
        });
        if (initLogs) {
          await appendBuildLogs(db, deployment.id, `[${initContainer}]\n${initLogs}`);
        }
      } catch (err) {
        log.warn({ err: String(err), initContainer }, "failed to collect init logs");
      }
    }
    const reason = jobStatus.failureReason ?? "build failed";
    await failDeployment(deployment.id, "build.failed", reason);
    await deleteBuildJob(k, namespace, jobName).catch(() => undefined);
    throw new Error(reason);
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @korepush/worker typecheck`
Expected: PASS (the Task 4 error is now resolved).

- [ ] **Step 4: Manifest sanity check (ad-hoc test)**

Create a throwaway check and run it (do NOT commit this file):

Run:
```bash
cat > /tmp/bj-check.ts <<'TS'
import { buildJobManifest } from "./apps/worker/src/k8s/build-job.ts";
import assert from "node:assert";

const base = {
  namespace: "ns", name: "build-x", image: "moby/buildkit:rootless",
  gitRepoUrl: "https://github.com/acme/app.git", gitRef: "main",
  dockerfilePath: "Dockerfile", buildContext: ".",
  imageDestinations: ["reg/app:tag"], labels: {
    projectId: "p", projectSlug: "app", environmentId: "e",
    environmentSlug: "production", deploymentId: "d", component: "build" as const,
  },
};

const df = buildJobManifest({ ...base, buildMode: "dockerfile" });
const initsD = df.spec.template.spec.initContainers.map((c: any) => c.name);
assert.deepStrictEqual(initsD, ["git-clone"], "dockerfile mode: only git-clone init");

const nx = buildJobManifest({
  ...base, buildMode: "nixpacks", nixpacksImage: "ghcr.io/x/nixpacks:latest",
});
const initsN = nx.spec.template.spec.initContainers.map((c: any) => c.name);
assert.deepStrictEqual(initsN, ["git-clone", "nixpacks-prep"], "nixpacks mode: prep added");
const args = nx.spec.template.spec.containers[0].args.join(" ");
assert.ok(args.includes("dockerfile=/workspace/repo/.nixpacks"), "nixpacks dockerfile dir");
assert.ok(args.includes("filename=Dockerfile"), "nixpacks filename");

let threw = false;
try { buildJobManifest({ ...base, buildMode: "nixpacks" }); } catch { threw = true; }
assert.ok(threw, "nixpacks without image must throw");

console.log("OK: build-job manifest sanity checks passed");
TS
pnpm exec tsx /tmp/bj-check.ts
```
Expected: `OK: build-job manifest sanity checks passed`. Then `rm /tmp/bj-check.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/handlers/deploy-project.ts
git commit -m "worker: pass build mode to build job and surface init-container logs on failure"
```

---

## Task 7: Nixpacks Docker image

**Files:**
- Create: `docker/nixpacks/Dockerfile`

- [ ] **Step 1: Find the current Nixpacks version + asset naming**

Run: `gh release list -R railwayapp/nixpacks -L 1` (or open https://github.com/railwayapp/nixpacks/releases). Note the latest tag, e.g. `v1.34.0`. Then check the asset names for that release:

Run: `gh release view <tag> -R railwayapp/nixpacks --json assets -q '.assets[].name'`
Expected: tarball names like `nixpacks-v1.34.0-x86_64-unknown-linux-musl.tar.gz` and `nixpacks-v1.34.0-aarch64-unknown-linux-musl.tar.gz`. Record the exact pattern; the Dockerfile below assumes this `nixpacks-v<ver>-<rust-target>.tar.gz` naming.

- [ ] **Step 2: Write the Dockerfile**

Create `docker/nixpacks/Dockerfile` (replace `1.34.0` with the version from Step 1 if different; map `TARGETARCH` to the rust target as confirmed in Step 1):

```dockerfile
# syntax=docker/dockerfile:1.7
# Image whose only job is to provide a pinned `nixpacks` binary so a build Job
# can generate a Dockerfile from a repo. Multi-arch via TARGETARCH.
FROM debian:bookworm-slim

ARG NIXPACKS_VERSION=1.34.0
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Map Docker's TARGETARCH (amd64|arm64) to nixpacks' rust target triple.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) target="x86_64-unknown-linux-musl" ;; \
      arm64) target="aarch64-unknown-linux-musl" ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/railwayapp/nixpacks/releases/download/v${NIXPACKS_VERSION}/nixpacks-v${NIXPACKS_VERSION}-${target}.tar.gz"; \
    curl -fsSL "$url" -o /tmp/nixpacks.tar.gz; \
    tar -xzf /tmp/nixpacks.tar.gz -C /usr/local/bin nixpacks; \
    rm /tmp/nixpacks.tar.gz; \
    /usr/local/bin/nixpacks --version

# Build Jobs run as uid 1000 (pod securityContext); no USER needed here since
# the binary is on PATH and world-executable.
ENTRYPOINT []
```

- [ ] **Step 3: Build the image locally for the VM (arm64) and confirm the binary works**

Run:
```bash
docker build --platform linux/arm64 -t ghcr.io/arthurliebhardt/korepush2-nixpacks:dev-local -f docker/nixpacks/Dockerfile docker/nixpacks
docker run --rm ghcr.io/arthurliebhardt/korepush2-nixpacks:dev-local nixpacks --version
docker run --rm ghcr.io/arthurliebhardt/korepush2-nixpacks:dev-local nixpacks build --help | grep -- "--out"
```
Expected: prints a nixpacks version, and `--help` shows an `--out` flag. If `--out` is absent or behaves differently, revisit Task 4 Step 3's script.

- [ ] **Step 4: Commit**

```bash
git add docker/nixpacks/Dockerfile
git commit -m "docker: add pinned nixpacks image for dockerfile-less builds"
```

---

## Task 8: CI — publish the nixpacks image

**Files:**
- Modify: `.github/workflows/images.yml:31-34,70-85,7-16`

- [ ] **Step 1: Convert the matrix to carry per-image Dockerfile paths + context**

Replace the `strategy:` block (lines ~31-34) with:

```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
          - app: web
            file: apps/web/Dockerfile
            context: .
          - app: worker
            file: apps/worker/Dockerfile
            context: .
          - app: nixpacks
            file: docker/nixpacks/Dockerfile
            context: docker/nixpacks
```

- [ ] **Step 2: Use the matrix file/context in the build step**

In the `Build and push` step (lines ~70-85), change:

```yaml
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.file }}
```

(Leave `images:` in the `meta` step as-is — it already uses `${{ matrix.app }}`, producing `...-nixpacks`.)

- [ ] **Step 3: Add the nixpacks Dockerfile to the PR path filter**

In the `on.pull_request.paths` list (lines ~8-16), add:

```yaml
      - "docker/nixpacks/Dockerfile"
```

- [ ] **Step 4: Validate the workflow YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/images.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/images.yml
git commit -m "ci: build and publish the nixpacks image"
```

---

## Task 9: API — accept buildMode (create, update, snapshot)

**Files:**
- Modify: `apps/web/app/api/projects/route.ts:17-27,86-91,114-129`
- Modify: `apps/web/app/api/projects/[projectId]/route.ts:10-17,45-64`
- Modify: `apps/web/app/api/projects/[projectId]/deployments/route.ts:71-83`

- [ ] **Step 1: Project create — accept + validate + persist buildMode**

In `apps/web/app/api/projects/route.ts`:

Add to the `Create` zod object (after `buildTarget`):

```ts
  buildMode: z.enum(["dockerfile", "nixpacks"]).default("dockerfile"),
```

Change the validation block (lines ~86-91) to skip Dockerfile-path validation in nixpacks mode:

```ts
  try {
    if (input.buildMode === "dockerfile") validateDockerfilePath(input.dockerfilePath);
    validateBuildContext(input.buildContext);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
```

Change the project insert (the `buildMode: "dockerfile",` line ~124) to:

```ts
      buildMode: input.buildMode,
```

- [ ] **Step 2: Project update (PATCH) — accept + persist buildMode**

In `apps/web/app/api/projects/[projectId]/route.ts`:

Add to the `Update` zod object:

```ts
  buildMode: z.enum(["dockerfile", "nixpacks"]).optional(),
```

Change the validation block (lines ~46-51) so Dockerfile path is only validated when the effective mode is dockerfile:

```ts
  const u = parsed.data;
  try {
    const effMode = u.buildMode ?? ctx.project.buildMode;
    if (effMode === "dockerfile" && u.dockerfilePath) validateDockerfilePath(u.dockerfilePath);
    if (u.buildContext) validateBuildContext(u.buildContext);
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }
```

Add to the `.set({ ... })` object (after the `buildTarget` spread):

```ts
      ...(u.buildMode !== undefined ? { buildMode: u.buildMode } : {}),
```

- [ ] **Step 3: Deployment create — snapshot buildMode**

In `apps/web/app/api/projects/[projectId]/deployments/route.ts`, in the `db.insert(schema.deployments).values({ ... })` block (lines ~71-83), add (after `buildTarget: ctx.project.buildTarget,`):

```ts
      buildMode: ctx.project.buildMode,
```

- [ ] **Step 4: Typecheck the web app**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors. (`ctx.project.buildMode` exists on the row; `ctx.project.buildTarget` is already referenced nearby, confirming the project shape.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/projects/route.ts apps/web/app/api/projects/\[projectId\]/route.ts apps/web/app/api/projects/\[projectId\]/deployments/route.ts
git commit -m "web/api: accept and persist project build mode (dockerfile | nixpacks)"
```

---

## Task 10: UI — build-mode toggle in the new-project form

**Files:**
- Modify: `apps/web/app/dashboard/projects/new/new-project-form.tsx:39-41,111-122,162-201`

- [ ] **Step 1: Add buildMode state**

After the `const [buildContext, setBuildContext] = useState(".");` line (~40), add:

```tsx
  const [buildMode, setBuildMode] = useState<"dockerfile" | "nixpacks">("dockerfile");
```

- [ ] **Step 2: Send buildMode in the POST body**

In `onSubmit`, add `buildMode,` to the JSON body (after `buildContext,`):

```tsx
        buildContext,
        buildMode,
        port: Number(port),
```

- [ ] **Step 3: Render the toggle and conditionally hide the Dockerfile field**

Replace the build-config block (the `<div className="border-t ...">` containing Dockerfile path + Build context, ~162-201) with one that adds a mode selector and hides the Dockerfile path in nixpacks mode:

```tsx
      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-5 space-y-4">
        <Field
          name="name"
          label="Project name"
          placeholder="api"
          value={name}
          onChange={setName}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            name="defaultBranch"
            label="Branch"
            value={defaultBranch}
            onChange={setDefaultBranch}
            disabled={mode === "github" && !!selectedRepo}
          />
          <Field
            name="port"
            label="Container port"
            type="number"
            value={String(port)}
            onChange={(v) => setPort(Number(v))}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="buildMode">Build</Label>
          <div className="flex gap-1" id="buildMode">
            <BuildModeButton active={buildMode === "dockerfile"} onClick={() => setBuildMode("dockerfile")}>
              Dockerfile
            </BuildModeButton>
            <BuildModeButton active={buildMode === "nixpacks"} onClick={() => setBuildMode("nixpacks")}>
              Nixpacks (auto-detect)
            </BuildModeButton>
          </div>
          <p className="text-xs text-zinc-500">
            {buildMode === "nixpacks"
              ? "Nixpacks detects your stack and generates the image — no Dockerfile needed."
              : "Build from a Dockerfile in your repo."}
          </p>
        </div>

        {buildMode === "dockerfile" ? (
          <Field
            name="dockerfilePath"
            label="Dockerfile path"
            value={dockerfilePath}
            onChange={setDockerfilePath}
            hint="Relative to repo root, e.g. apps/api/Dockerfile"
          />
        ) : null}
        <Field
          name="buildContext"
          label="Build context"
          value={buildContext}
          onChange={setBuildContext}
          hint="Directory passed to the build."
        />
      </div>
```

- [ ] **Step 4: Add the BuildModeButton component**

At the bottom of the file (next to the other helper components like `TabButton`), add:

```tsx
function BuildModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-3 py-1.5 text-sm rounded-md border " +
        (active
          ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900")
      }
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/dashboard/projects/new/new-project-form.tsx
git commit -m "web: build-mode toggle (Dockerfile | Nixpacks) in new-project form"
```

---

## Task 11: UI — build-mode toggle in project settings

**Files:**
- Modify: `apps/web/app/dashboard/projects/[projectId]/settings/page.tsx:21-30`
- Modify: `apps/web/app/dashboard/projects/[projectId]/settings/settings-form.tsx`

- [ ] **Step 1: Pass buildMode into the form**

In `settings/page.tsx`, add `buildMode` to the `initial` prop:

```tsx
            initial={{
              name: project.name,
              defaultBranch: project.gitDefaultBranch,
              buildMode: project.buildMode as "dockerfile" | "nixpacks",
              dockerfilePath: project.dockerfilePath,
              buildContext: project.buildContext,
              port: project.port,
            }}
```

- [ ] **Step 2: Add buildMode to the form's Initial type + state + payload**

In `settings-form.tsx`, change the `Initial` interface to include:

```ts
  buildMode: "dockerfile" | "nixpacks";
```

In `save`, add `buildMode: state.buildMode,` to the PATCH body (after `defaultBranch`).

- [ ] **Step 3: Render the toggle and conditionally hide the Dockerfile path field**

Replace the `<Pair label="Dockerfile path"> ... </Pair>` block with a mode toggle plus a conditional Dockerfile path:

```tsx
      <Pair label="Build">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setState({ ...state, buildMode: "dockerfile" })}
            className={btn(state.buildMode === "dockerfile")}
          >
            Dockerfile
          </button>
          <button
            type="button"
            onClick={() => setState({ ...state, buildMode: "nixpacks" })}
            className={btn(state.buildMode === "nixpacks")}
          >
            Nixpacks
          </button>
        </div>
      </Pair>
      {state.buildMode === "dockerfile" ? (
        <Pair label="Dockerfile path">
          <Input
            value={state.dockerfilePath}
            onChange={(e) => setState({ ...state, dockerfilePath: e.target.value })}
          />
        </Pair>
      ) : null}
```

And add the `btn` helper near the `Pair` helper at the bottom of the file:

```tsx
function btn(active: boolean): string {
  return (
    "px-3 py-1.5 text-sm rounded-md border " +
    (active
      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
      : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900")
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/projects/\[projectId\]/settings/page.tsx apps/web/app/dashboard/projects/\[projectId\]/settings/settings-form.tsx
git commit -m "web: build-mode toggle in project settings"
```

---

## Task 12: End-to-end verification in the OrbStack VM

**Files:** none (verification only)

This validates the full feature against the real cluster. The VM (`korepush-test`, arm64, k3s) currently runs `:dev-local` patched web+worker images. Commands run from the repo root; VM commands via `orb -m korepush-test -u root bash -c '...'`.

- [ ] **Step 1: Apply the new migration in the VM**

Build/import the latest worker image (it carries the migrate entrypoint) is not required just for migration; run the migration Job-style. Simplest: exec the migrate against the in-cluster DB using the worker image already present. Run:
```bash
orb -m korepush-test -u root bash -c 'kubectl -n korepush-system create job buildmode-migrate-$(date +%s) --image=ghcr.io/arthurliebhardt/korepush2-worker:dev-local -- ./node_modules/.bin/tsx ./node_modules/@korepush/db/src/migrate.ts'
```
Then, after rebuilding/importing the new worker image in Step 2, re-run if the column is missing. Expected (after the new worker image is in place): the migration adds `build_mode`. Verify:
```bash
orb -m korepush-test -u root bash -c "kubectl -n korepush-system exec statefulset/postgres -- psql -U korepush -d korepush -c '\\d deployments' | grep build_mode"
```
Expected: a `build_mode` column row.

- [ ] **Step 2: Build + import the nixpacks, web, and worker images into the VM**

Run (mirrors the established dev-local flow used for earlier fixes):
```bash
for app in nixpacks web worker; do :; done
docker build --platform linux/arm64 -t ghcr.io/arthurliebhardt/korepush2-nixpacks:dev-local -f docker/nixpacks/Dockerfile docker/nixpacks
docker build --platform linux/arm64 -t ghcr.io/arthurliebhardt/korepush2-worker:dev-local -f apps/worker/Dockerfile .
docker build --platform linux/arm64 -t ghcr.io/arthurliebhardt/korepush2-web:dev-local -f apps/web/Dockerfile .
for img in nixpacks worker web; do docker save ghcr.io/arthurliebhardt/korepush2-$img:dev-local -o /Users/arthur/$img-dl.tar; done
orb -m korepush-test -u root bash -c 'for img in nixpacks worker web; do k3s ctr images import /Users/arthur/$img-dl.tar; done'
rm -f /Users/arthur/nixpacks-dl.tar /Users/arthur/worker-dl.tar /Users/arthur/web-dl.tar
```
Then set the worker to use the local nixpacks image and restart web+worker:
```bash
orb -m korepush-test -u root bash -c '
kubectl -n korepush-system set env deploy/worker NIXPACKS_IMAGE=ghcr.io/arthurliebhardt/korepush2-nixpacks:dev-local
kubectl -n korepush-system rollout restart deploy/worker deploy/web
kubectl -n korepush-system rollout status deploy/worker --timeout=120s
kubectl -n korepush-system rollout status deploy/web --timeout=120s'
```
Expected: both roll out successfully.

- [ ] **Step 3: Switch ecomdesignlab to Nixpacks and redeploy**

In the dashboard (http://korepush-test.orb.local:8000), open the ecomdesignlab project → Settings → set Build = Nixpacks → Save. Then trigger a Redeploy. (No Dockerfile is needed in the repo.)

- [ ] **Step 4: Watch the build**

Run:
```bash
orb -m korepush-test -u root bash -c '
ns=p-ecomdesignlab-prod
for i in $(seq 1 240); do pod=$(kubectl -n $ns get pods --no-headers 2>/dev/null | grep -i build | awk "{print \$1}" | head -1); [ -n "$pod" ] && break; sleep 1; done
echo "pod=$pod"
kubectl -n $ns wait --for=condition=Initialized pod/$pod --timeout=300s || true
echo "=== nixpacks-prep logs ==="; kubectl -n $ns logs $pod -c nixpacks-prep 2>&1 | tail -20
for i in $(seq 1 150); do ph=$(kubectl -n $ns get pod $pod -o jsonpath="{.status.phase}" 2>/dev/null); [ "$ph" = "Succeeded" ] || [ "$ph" = "Failed" ] && break; sleep 2; done
echo "phase=$ph"
echo "=== builder logs tail ==="; kubectl -n $ns logs $pod -c builder --tail=40 2>&1'
```
Expected: `nixpacks-prep` generates a Dockerfile (no error), the `builder` runs a real BuildKit build of the Vite app, and the pod ends `Succeeded`.

- [ ] **Step 5: Confirm the app rolled out**

Run:
```bash
orb -m korepush-test -u root bash -c 'kubectl -n p-ecomdesignlab-prod get deploy,pods'
```
Expected: an `app` Deployment with a Ready pod. In the dashboard the deployment status is `ready`.

- [ ] **Step 6: Confirm failure diagnosability (negative check)**

Temporarily set the project's branch to a nonexistent ref (Settings → Default branch → `does-not-exist-xyz`) and redeploy, then check the dashboard build logs show the `[git-clone]` init-container error (not "No logs yet"). Restore the branch afterward.
Expected: the dashboard shows a git fetch error from the init container.

---

## Self-review notes

- **Spec coverage:** data model (Tasks 1–2), nixpacks image (Task 7), CI publish (Task 8), build-job integration (Tasks 4, 6), env var (Task 3), UI+API (Tasks 9–11), error/diagnosability (Tasks 5–6), testing/e2e (Task 6 Step 4, Task 12). All spec sections mapped.
- **Naming consistency:** init container `nixpacks-prep` and generated path `/workspace/repo/.nixpacks/Dockerfile` are used identically in Tasks 4, 6, and 12. `buildMode` values `"dockerfile" | "nixpacks"` consistent across shared/db/worker/api/ui. Image name `ghcr.io/arthurliebhardt/korepush2-nixpacks` consistent in Tasks 3, 7, 8, 12 and env default (Task 3).
- **Known integration risks flagged inline:** exact `nixpacks ... --out` behavior (Task 4 Step 3 / Task 7 Step 3) and the release asset naming/version (Task 7 Step 1) must be verified against the pinned version during implementation.
