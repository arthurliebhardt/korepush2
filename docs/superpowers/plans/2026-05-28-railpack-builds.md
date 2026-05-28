# Railpack builds (replacing Nixpacks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the just-shipped `nixpacks` build mode with `railpack` (Railway's successor): projects build via `railpack prepare` + the BuildKit gateway frontend, reusing korepush's existing rootless-BuildKit Job.

**Architecture:** Rename the auto-build `buildMode` from `nixpacks` to `railpack`. A `railpack-prep` init container (our pinned Railpack CLI image) runs `railpack prepare --plan-out /workspace/repo/railpack-plan.json /workspace/repo`; the existing `builder` then builds with `buildctl --frontend gateway.v0 --opt source=<railpack-frontend image> --opt filename=railpack-plan.json`. All Nixpacks code is removed.

**Tech Stack:** TypeScript monorepo (pnpm + turbo), Next.js web, Node worker (`@kubernetes/client-node`), Drizzle + Postgres, Docker/BuildKit, Railpack, GitHub Actions.

**Pinned versions (verified during planning):**
- Railpack CLI: **v0.23.0**. Linux release assets: `railpack-v0.23.0-x86_64-unknown-linux-musl.tar.gz` (amd64), `railpack-v0.23.0-arm64-unknown-linux-musl.tar.gz` (arm64). Note the arm64 triple is `arm64-unknown-linux-musl` (NOT `aarch64`).
- Railpack frontend: **`ghcr.io/railwayapp/railpack-frontend:v0.23.0`** — multi-arch (amd64+arm64), identical digest to `:latest` at time of planning.
- `railpack prepare --plan-out <file> <dir>` is the confirmed plan-only invocation.

**Testing note:** No automated test framework in the repo; none is introduced. "Tests" = typechecks + an ad-hoc manifest assertion (`tsx`) + manual VM e2e. Commit frequently.

**Spec:** `docs/superpowers/specs/2026-05-28-railpack-builds-design.md`

**Starting point:** `main` (the Nixpacks feature is already merged here). Create a feature branch before Task 1: `git checkout -b feat/railpack-builds`.

---

## File structure

- `packages/shared/src/constants.ts` — `BUILD_MODES` → `["dockerfile","railpack"]`.
- `packages/db/drizzle/*` — new **custom** data migration renaming `nixpacks` → `railpack`.
- `apps/worker/src/env.ts` — replace `nixpacksImage` with `railpackImage` + `railpackFrontendImage`.
- `apps/worker/src/k8s/build-job.ts` — replace the nixpacks prep + dockerfile-override logic with railpack prep + gateway-frontend logic.
- `apps/worker/src/handlers/deploy-project.ts` — pass the railpack images; init-log loop uses `railpack-prep`.
- `apps/web/app/api/projects/route.ts`, `apps/web/app/api/projects/[projectId]/route.ts` — zod enums `["dockerfile","railpack"]`.
- `apps/web/app/dashboard/projects/new/new-project-form.tsx`, `.../settings/settings-form.tsx`, `.../settings/page.tsx` — `nixpacks` → `railpack` in types/state/labels.
- `docker/railpack/Dockerfile` — new pinned Railpack CLI image. **Delete** `docker/nixpacks/Dockerfile`.
- `.github/workflows/images.yml` — matrix `nixpacks` entry → `railpack`; PR path filter update.

---

## Task 1: Branch + shared enum

**Files:** Modify `packages/shared/src/constants.ts`.

- [ ] **Step 1: Create the feature branch**

Run: `git checkout -b feat/railpack-builds && git rev-parse --abbrev-ref HEAD`
Expected: `feat/railpack-builds`.

- [ ] **Step 2: Update the enum**

In `packages/shared/src/constants.ts`, change:
```ts
export const BUILD_MODES = ["dockerfile", "nixpacks"] as const;
```
to:
```ts
export const BUILD_MODES = ["dockerfile", "railpack"] as const;
```
(`BuildMode` in `types.ts` derives from this — no change needed there.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @korepush/shared typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts
git commit -m "shared: change build mode nixpacks -> railpack"
```

---

## Task 2: Data migration (rename existing nixpacks rows)

**Files:** Generate a custom migration under `packages/db/drizzle/`.

The `build_mode` columns already exist (free-text, default `'dockerfile'`); only the stored VALUE changes, so `drizzle-kit generate` (schema diff) produces nothing. Use a **custom** migration for the data update.

- [ ] **Step 1: Generate an empty custom migration**

Run: `DATABASE_URL=postgres://dummy pnpm --filter @korepush/db exec drizzle-kit generate --custom --name rename_nixpacks_to_railpack`
Expected: a new empty file `packages/db/drizzle/0003_*.sql` (e.g. `0003_rename_nixpacks_to_railpack.sql`) and an updated `_journal.json`. (The `DATABASE_URL=postgres://dummy` satisfies the config's load-time guard; `generate` does not connect.)

- [ ] **Step 2: Fill in the migration SQL**

Edit the generated `packages/db/drizzle/0003_*.sql` to contain exactly:
```sql
UPDATE "projects" SET "build_mode" = 'railpack' WHERE "build_mode" = 'nixpacks';
UPDATE "deployments" SET "build_mode" = 'railpack' WHERE "build_mode" = 'nixpacks';
```

- [ ] **Step 3: Verify journal + file**

Run: `git status --short packages/db/drizzle && ls -t packages/db/drizzle/*.sql | head -1 | xargs cat`
Expected: the two UPDATE statements; `_journal.json` has a new entry for tag `0003_*`. No schema/snapshot changes to other tables.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @korepush/db typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle
git commit -m "db: data migration renaming build_mode nixpacks -> railpack"
```

---

## Task 3: Worker env — railpack images

**Files:** Modify `apps/worker/src/env.ts`.

- [ ] **Step 1: Replace the nixpacks env entry**

In `apps/worker/src/env.ts`, remove the `nixpacksImage` entry and add:
```ts
  // Railpack CLI image used by the per-deploy build Job to generate a build
  // plan (buildMode=railpack). Pinned build published by CI; overridable.
  railpackImage:
    process.env.RAILPACK_IMAGE ??
    "ghcr.io/arthurliebhardt/korepush2-railpack:latest",
  // Railpack's BuildKit gateway frontend image, pulled by the builder at build
  // time. Pinned to match the CLI version.
  railpackFrontendImage:
    process.env.RAILPACK_FRONTEND_IMAGE ??
    "ghcr.io/railwayapp/railpack-frontend:v0.23.0",
```

- [ ] **Step 2: Typecheck (expected to fail until Task 5)**

Run: `pnpm --filter @korepush/worker typecheck`
Expected: errors only about `nixpacksImage` no longer existing (referenced in build-job.ts / deploy-project.ts), fixed in Tasks 4–5. Confirm there are no OTHER errors in env.ts.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/env.ts
git commit -m "worker: replace NIXPACKS_IMAGE env with RAILPACK_IMAGE + RAILPACK_FRONTEND_IMAGE"
```

---

## Task 4: build-job.ts — railpack prep + gateway frontend

**Files:** Modify `apps/worker/src/k8s/build-job.ts`.

- [ ] **Step 1: Update BuildJobArgs**

Replace the `buildMode`/`nixpacksImage` fields (currently the JSDoc + `buildMode: BuildMode;` + `nixpacksImage?: string;`) with:
```ts
  /** dockerfile | railpack. In railpack mode a prep init container generates a
   * build plan and the user's dockerfilePath is ignored. */
  buildMode: BuildMode;
  /** Railpack CLI image (runs `railpack prepare`); required when buildMode=railpack. */
  railpackImage?: string;
  /** Railpack BuildKit gateway frontend image; required when buildMode=railpack. */
  railpackFrontendImage?: string;
```

- [ ] **Step 2: Replace the NIXPACKS_OUT_DIR constant**

Change:
```ts
const NIXPACKS_OUT_DIR = `${REPO_DIR}/.nixpacks`;
```
to:
```ts
const RAILPACK_PLAN = `${REPO_DIR}/railpack-plan.json`;
```

- [ ] **Step 3: Replace the nixpacks prep init-container block**

Replace the entire `if (args.buildMode === "nixpacks") { ... }` block with:
```ts
  if (args.buildMode === "railpack") {
    if (!args.railpackImage || !args.railpackFrontendImage) {
      throw new Error(
        "railpackImage and railpackFrontendImage are required when buildMode is railpack",
      );
    }
    // Generate a Railpack build plan from the cloned repo. `railpack prepare`
    // writes the plan only (no Docker build); the builder consumes it via the
    // gateway frontend. Runs as uid 1000 (pod securityContext); repo is already
    // 1000-owned by git-clone.
    const railpackScript = [
      `set -eu`,
      `cd ${REPO_DIR}`,
      `railpack prepare ${REPO_DIR} --plan-out ${RAILPACK_PLAN}`,
      `test -f ${RAILPACK_PLAN}`,
    ].join("\n");
    initContainers.push({
      name: "railpack-prep",
      image: args.railpackImage,
      command: ["/bin/sh", "-c"],
      args: [railpackScript],
      env: [],
      volumeMounts: [{ name: "workspace", mountPath: WORKSPACE }],
    });
  }
```

- [ ] **Step 4: Replace the eff* vars + buildctlArgs with railpack-aware logic**

Replace the block from `// In nixpacks mode, ignore ...` through the end of the `const buildctlArgs = [ ... ];` array with:
```ts
  // In railpack mode, build the generated plan via the gateway frontend with
  // the repo root as context (so the plan's relative paths resolve). Otherwise
  // use the built-in dockerfile frontend with the user's dockerfilePath.
  const isRailpack = args.buildMode === "railpack";
  const effContext = isRailpack ? REPO_DIR : absContext;
  const effDockerfileDir = isRailpack ? REPO_DIR : absDockerfileDir;
  const effFilename = isRailpack ? "railpack-plan.json" : dockerfileName;

  const buildctlArgs = [
    "build",
    "--frontend", isRailpack ? "gateway.v0" : "dockerfile.v0",
    ...(isRailpack ? ["--opt", `source=${args.railpackFrontendImage}`] : []),
    "--local", `context=${effContext}`,
    "--local", `dockerfile=${effDockerfileDir}`,
    "--opt", `filename=${effFilename}`,
    "--output", outputSpec,
    "--progress", "plain",
  ];
```

- [ ] **Step 5: Typecheck (expected to fail until Task 5)**

Run: `pnpm --filter @korepush/worker typecheck`
Expected: errors only at the `buildJobManifest(...)` call site in `deploy-project.ts` (passes `nixpacksImage`, missing `railpackImage`/`railpackFrontendImage`) — fixed in Task 5. No other errors.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/k8s/build-job.ts
git commit -m "worker: build job uses railpack prepare + gateway frontend"
```

---

## Task 5: deploy-project.ts — pass railpack images + init-log loop

**Files:** Modify `apps/worker/src/handlers/deploy-project.ts`.

- [ ] **Step 1: Update the buildJobManifest call**

Replace the line:
```ts
    nixpacksImage: env.nixpacksImage,
```
with:
```ts
    railpackImage: env.railpackImage,
    railpackFrontendImage: env.railpackFrontendImage,
```
(Leave `buildMode: deployment.buildMode as BuildMode,` as-is.)

- [ ] **Step 2: Update the init-log container list**

Replace:
```ts
    const initContainerNames =
      deployment.buildMode === "nixpacks" ? ["git-clone", "nixpacks-prep"] : ["git-clone"];
```
with:
```ts
    const initContainerNames =
      deployment.buildMode === "railpack" ? ["git-clone", "railpack-prep"] : ["git-clone"];
```

- [ ] **Step 3: Typecheck (should pass now)**

Run: `pnpm --filter @korepush/worker typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Manifest sanity check (ad-hoc)**

Create and run (do NOT commit):
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
assert.deepStrictEqual(
  df.spec.template.spec.initContainers.map((c: any) => c.name), ["git-clone"],
  "dockerfile: only git-clone init");
const dfArgs = df.spec.template.spec.containers[0].args.join(" ");
assert.ok(dfArgs.includes("--frontend dockerfile.v0"), "dockerfile: dockerfile.v0 frontend");

const rp = buildJobManifest({
  ...base, buildMode: "railpack",
  railpackImage: "ghcr.io/x/railpack:latest",
  railpackFrontendImage: "ghcr.io/railwayapp/railpack-frontend:v0.23.0",
});
assert.deepStrictEqual(
  rp.spec.template.spec.initContainers.map((c: any) => c.name), ["git-clone", "railpack-prep"],
  "railpack: prep added");
const rpArgs = rp.spec.template.spec.containers[0].args.join(" ");
assert.ok(rpArgs.includes("--frontend gateway.v0"), "railpack: gateway frontend");
assert.ok(rpArgs.includes("source=ghcr.io/railwayapp/railpack-frontend:v0.23.0"), "railpack: frontend source opt");
assert.ok(rpArgs.includes("filename=railpack-plan.json"), "railpack: plan filename");

let threw = false;
try { buildJobManifest({ ...base, buildMode: "railpack" }); } catch { threw = true; }
assert.ok(threw, "railpack without images must throw");

console.log("OK: build-job railpack manifest checks passed");
TS
pnpm --filter @korepush/worker exec tsx /tmp/bj-check.ts && rm /tmp/bj-check.ts
```
Expected: `OK: build-job railpack manifest checks passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/handlers/deploy-project.ts
git commit -m "worker: pass railpack images to build job; collect railpack-prep logs on failure"
```

---

## Task 6: Railpack CLI image (replaces the Nixpacks image)

**Files:** Create `docker/railpack/Dockerfile`; delete `docker/nixpacks/Dockerfile`.

- [ ] **Step 1: Write the Dockerfile**

Create `docker/railpack/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1.7
# Image whose only job is to provide a pinned `railpack` binary so a build Job
# can generate a railpack build plan from a repo. Multi-arch via TARGETARCH.
FROM debian:bookworm-slim

ARG RAILPACK_VERSION=0.23.0
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Map Docker's TARGETARCH (amd64|arm64) to railpack's release target triple.
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) target="x86_64-unknown-linux-musl" ;; \
      arm64) target="arm64-unknown-linux-musl" ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-${target}.tar.gz"; \
    curl -fsSL "$url" -o /tmp/railpack.tar.gz; \
    tar -xzf /tmp/railpack.tar.gz -C /usr/local/bin railpack; \
    rm /tmp/railpack.tar.gz; \
    /usr/local/bin/railpack --version

# Build Jobs run as uid 1000 (pod securityContext); binary is on PATH and
# world-executable, so no USER needed.
ENTRYPOINT []
```

- [ ] **Step 2: Build for arm64 and verify the binary + prepare flag**

Run:
```bash
docker build --platform linux/arm64 -t ghcr.io/arthurliebhardt/korepush2-railpack:dev-local -f docker/railpack/Dockerfile docker/railpack
docker run --rm ghcr.io/arthurliebhardt/korepush2-railpack:dev-local railpack --version
docker run --rm ghcr.io/arthurliebhardt/korepush2-railpack:dev-local railpack prepare --help 2>&1 | grep -- "--plan-out"
```
Expected: prints `railpack 0.23.0` (or similar) and the `--plan-out` flag appears in `prepare --help`.

- [ ] **Step 3: Daemon-free plan-generation smoke test**

Run:
```bash
docker run --rm ghcr.io/arthurliebhardt/korepush2-railpack:dev-local sh -c \
  'mkdir -p /t && cd /t && printf "{\"name\":\"x\",\"version\":\"1.0.0\",\"scripts\":{\"build\":\"true\",\"start\":\"node -e 0\"}}" > package.json && railpack prepare /t --plan-out /t/railpack-plan.json && test -f /t/railpack-plan.json && echo PLAN_OK'
```
Expected: `PLAN_OK` (plan generated with no Docker daemon). If `railpack prepare` errors or needs a daemon, STOP and report DONE_WITH_CONCERNS with the exact error and correct invocation.

- [ ] **Step 4: Delete the Nixpacks image**

Run: `git rm docker/nixpacks/Dockerfile`

- [ ] **Step 5: Commit**

```bash
git add docker/railpack/Dockerfile
git commit -m "docker: add pinned railpack CLI image; remove nixpacks image"
```

---

## Task 7: CI — publish the railpack image (drop nixpacks)

**Files:** Modify `.github/workflows/images.yml`.

- [ ] **Step 1: Replace the matrix `nixpacks` entry**

In the `strategy.matrix.include` list, replace the `nixpacks` entry:
```yaml
          - app: nixpacks
            file: docker/nixpacks/Dockerfile
            context: docker/nixpacks
```
with:
```yaml
          - app: railpack
            file: docker/railpack/Dockerfile
            context: docker/railpack
```

- [ ] **Step 2: Update the PR path filter**

In `on.pull_request.paths`, change `- "docker/nixpacks/Dockerfile"` to `- "docker/railpack/Dockerfile"`.

- [ ] **Step 3: Update the image-name comment**

Change the comment `# Image name: ghcr.io/<owner>/<repo>-{web,worker,nixpacks} ...` to `... -{web,worker,railpack} ...`.

- [ ] **Step 4: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/images.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/images.yml
git commit -m "ci: publish railpack image instead of nixpacks"
```

---

## Task 8: API — railpack in zod enums

**Files:** Modify `apps/web/app/api/projects/route.ts` and `apps/web/app/api/projects/[projectId]/route.ts`.

- [ ] **Step 1: Update create route enum**

In `apps/web/app/api/projects/route.ts`, change:
```ts
  buildMode: z.enum(["dockerfile", "nixpacks"]).default("dockerfile"),
```
to:
```ts
  buildMode: z.enum(["dockerfile", "railpack"]).default("dockerfile"),
```
(The validation gating `if (input.buildMode === "dockerfile")` is correct as-is.)

- [ ] **Step 2: Update PATCH route enum**

In `apps/web/app/api/projects/[projectId]/route.ts`, change:
```ts
  buildMode: z.enum(["dockerfile", "nixpacks"]).optional(),
```
to:
```ts
  buildMode: z.enum(["dockerfile", "railpack"]).optional(),
```
(The `effMode === "dockerfile"` gating is correct as-is.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/projects/route.ts apps/web/app/api/projects/\[projectId\]/route.ts
git commit -m "web/api: accept railpack build mode (was nixpacks)"
```

---

## Task 9: UI — railpack toggle labels/types

**Files:** Modify `apps/web/app/dashboard/projects/new/new-project-form.tsx`, `.../settings/settings-form.tsx`, `.../settings/page.tsx`.

- [ ] **Step 1: new-project form**

In `apps/web/app/dashboard/projects/new/new-project-form.tsx`:
- Change the state type/init:
  ```ts
  const [buildMode, setBuildMode] = useState<"dockerfile" | "nixpacks">("dockerfile");
  ```
  to:
  ```ts
  const [buildMode, setBuildMode] = useState<"dockerfile" | "railpack">("dockerfile");
  ```
- Change the second toggle button: `setBuildMode("nixpacks")`, `active={buildMode === "nixpacks"}`, label `Nixpacks (auto-detect)` → `setBuildMode("railpack")`, `active={buildMode === "railpack"}`, label `Railpack (auto-detect)`.
- Change the helper text condition `buildMode === "nixpacks"` → `buildMode === "railpack"` and the text `"Nixpacks detects your stack and generates the image — no Dockerfile needed."` → `"Railpack detects your stack and builds the image — no Dockerfile needed."`
- Change the Dockerfile-path render guard `{buildMode === "dockerfile" ? (...)}` — this stays (already keyed on `"dockerfile"`).

- [ ] **Step 2: settings page**

In `.../settings/page.tsx`, change the cast:
```ts
              buildMode: project.buildMode as "dockerfile" | "nixpacks",
```
to:
```ts
              buildMode: project.buildMode as "dockerfile" | "railpack",
```

- [ ] **Step 3: settings form**

In `.../settings/settings-form.tsx`:
- `Initial` type: `buildMode: "dockerfile" | "nixpacks";` → `buildMode: "dockerfile" | "railpack";`
- The two toggle buttons: replace the `"nixpacks"` button (`setState({ ...state, buildMode: "nixpacks" })`, `aria-pressed={state.buildMode === "nixpacks"}`, `btn(state.buildMode === "nixpacks")`, label `Nixpacks`) with `"railpack"` equivalents and label `Railpack`.
- The Dockerfile-path `<Pair>` guard `{state.buildMode === "dockerfile" ? ...}` stays.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dashboard/projects/new/new-project-form.tsx apps/web/app/dashboard/projects/\[projectId\]/settings/settings-form.tsx apps/web/app/dashboard/projects/\[projectId\]/settings/page.tsx
git commit -m "web: build-mode toggle uses railpack (was nixpacks)"
```

---

## Task 10: Final cleanup — no nixpacks references remain

**Files:** repo-wide check.

- [ ] **Step 1: Grep for stragglers**

Run: `grep -rni "nixpacks" apps packages docker .github --include="*.ts" --include="*.tsx" --include="*.yml" --include="Dockerfile" 2>/dev/null`
Expected: **no output**. If any remain (comments, strings, identifiers), fix them in place to railpack equivalents (do not touch `docs/superpowers/specs/2026-05-28-nixpacks-buildkit-builds-design.md` or the nixpacks plan/spec markdown — those are historical records).

- [ ] **Step 2: Full typecheck sweep**

Run: `pnpm --filter @korepush/shared typecheck && pnpm --filter @korepush/db typecheck && pnpm --filter @korepush/worker typecheck && pnpm --filter web exec tsc --noEmit`
Expected: all pass.

- [ ] **Step 3: Commit (only if Step 1 produced fixes)**

```bash
git add -A
git commit -m "chore: remove remaining nixpacks references"
```
If Step 1 had no output and no files changed, skip this commit.

---

## Task 11: VM end-to-end verification

**Files:** none (verification only). VM `korepush-test` (arm64, k3s). The VM currently runs `:dev-local` web/worker with the Nixpacks build job and `NIXPACKS_IMAGE` set; this task moves it to Railpack.

- [ ] **Step 1: Build + import the railpack, web, worker images (arm64)**

Run:
```bash
docker build --platform linux/arm64 -t ghcr.io/arthurliebhardt/korepush2-railpack:dev-local -f docker/railpack/Dockerfile docker/railpack
docker build --platform linux/arm64 -t ghcr.io/arthurliebhardt/korepush2-worker:dev-local -f apps/worker/Dockerfile .
docker build --platform linux/arm64 -t ghcr.io/arthurliebhardt/korepush2-web:dev-local -f apps/web/Dockerfile .
for img in railpack worker web; do docker save ghcr.io/arthurliebhardt/korepush2-$img:dev-local -o /Users/arthur/$img-dl.tar; done
orb -m korepush-test -u root bash -c 'for img in railpack worker web; do k3s ctr images import /Users/arthur/$img-dl.tar; done'
rm -f /Users/arthur/railpack-dl.tar /Users/arthur/worker-dl.tar /Users/arthur/web-dl.tar
```
Expected: three imports succeed.

- [ ] **Step 2: Apply the data migration to the VM DB**

The VM DB has `build_mode` already; run the rename UPDATEs (the project is currently `nixpacks`). This requires a direct psql exec — ask the user to approve the prompt if blocked:
```bash
orb -m korepush-test -u root bash -c "kubectl -n korepush-system exec statefulset/postgres -- psql -U korepush -d korepush -c \"UPDATE projects SET build_mode='railpack' WHERE build_mode='nixpacks'; UPDATE deployments SET build_mode='railpack' WHERE build_mode='nixpacks';\""
```
Then verify: `... -c "SELECT slug, build_mode FROM projects;"` → ecomdesignlab = railpack.

- [ ] **Step 3: Set the railpack image env + restart**

```bash
orb -m korepush-test -u root bash -c '
kubectl -n korepush-system set env deploy/worker NIXPACKS_IMAGE- RAILPACK_IMAGE=ghcr.io/arthurliebhardt/korepush2-railpack:dev-local RAILPACK_FRONTEND_IMAGE=ghcr.io/railwayapp/railpack-frontend:v0.23.0
kubectl -n korepush-system rollout restart deploy/worker deploy/web
kubectl -n korepush-system rollout status deploy/worker --timeout=120s
kubectl -n korepush-system rollout status deploy/web --timeout=120s'
```
(`NIXPACKS_IMAGE-` removes the old env var.) Expected: both roll out.

- [ ] **Step 4: Redeploy ecomdesignlab and watch the build**

In the dashboard (http://korepush-test.orb.local:8000), the ecomdesignlab project should already show Build = Railpack (migrated). Trigger a Redeploy. Then:
```bash
orb -m korepush-test -u root bash -c '
ns=p-ecomdesignlab-prod
for i in $(seq 1 240); do pod=$(kubectl -n $ns get pods --no-headers 2>/dev/null | grep -i build | sort | tail -1 | awk "{print \$1}"); [ -n "$pod" ] && break; sleep 1; done
echo "pod=$pod"
kubectl -n $ns wait --for=condition=Initialized pod/$pod --timeout=300s 2>&1 || true
echo "=== init exits ==="; kubectl -n $ns get pod $pod -o jsonpath="{range .status.initContainerStatuses[*]}{.name}=exit:{.state.terminated.exitCode}{\"\n\"}{end}"
echo "=== railpack-prep logs ==="; kubectl -n $ns logs $pod -c railpack-prep 2>&1 | tail -20
for i in $(seq 1 200); do ph=$(kubectl -n $ns get pod $pod -o jsonpath="{.status.phase}" 2>/dev/null); [ "$ph" = "Succeeded" ] || [ "$ph" = "Failed" ] && break; sleep 3; done
echo "=== phase=$ph ==="; kubectl -n $ns logs $pod -c builder --tail=50 2>&1'
```
Expected: `git-clone=exit:0`, `railpack-prep=exit:0` (plan generated), builder runs the gateway frontend and builds the Vite app; pod `Succeeded`.

- [ ] **Step 5: Confirm rollout**

Run: `orb -m korepush-test -u root bash -c 'kubectl -n p-ecomdesignlab-prod get deploy,pods'`
Expected: an `app` Deployment with a Ready pod; dashboard deployment status `ready`. (If Railpack still picks an unsupported runtime, that's repo config — out of scope; note it.)

---

## Self-review notes

- **Spec coverage:** enum (T1), data migration (T2), worker env (T3), build-job railpack prep + gateway frontend (T4), deploy handler (T5), railpack CLI image + delete nixpacks (T6), CI (T7), API (T8), UI (T9), cleanup/no-nixpacks (T10), VM e2e (T11). All spec sections mapped.
- **Naming consistency:** init container `railpack-prep`, plan file `railpack-plan.json` (const `RAILPACK_PLAN`), frontend `gateway.v0` + `source=$railpackFrontendImage`, enum values `dockerfile|railpack`, env `RAILPACK_IMAGE`/`RAILPACK_FRONTEND_IMAGE`, image `…-railpack` — consistent across T3/T4/T5/T6/T7/T11.
- **Pinned versions:** CLI v0.23.0 (arm64 triple `arm64-unknown-linux-musl`), frontend `:v0.23.0` — used identically in T3, T6, T11.
- **Flagged for implementation:** the daemon-free `railpack prepare` smoke test (T6 S3) and whether the gateway frontend needs `build-arg:secrets-hash`/`cache-key` opts — if the T11 builder errors complaining about missing build-args, add them to the railpack-mode `buildctlArgs` and note it.
```
