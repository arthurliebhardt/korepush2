# Nixpacks → BuildKit builds for Dockerfile-less repos

**Date:** 2026-05-28
**Status:** Approved — ready for implementation planning

## Problem

korepush builds every deployment with a rootless BuildKit Job that requires a
`Dockerfile` in the repo at a configured path. Repos without a Dockerfile (e.g.
a Vite/React frontend like `ecomdesignlab`) cannot be deployed — the build fails
with `failed to read dockerfile: open Dockerfile: no such file or directory`.

We want korepush to build such repos without the user authoring a Dockerfile, by
generating one with [Nixpacks](https://nixpacks.com) and feeding it to the
existing BuildKit Job.

## Goals

- A project can be configured to build with Nixpacks instead of a Dockerfile.
- Nixpacks auto-detects the stack, generates a Dockerfile, and BuildKit builds it
  using the existing in-cluster build pipeline (clone → build → push → rollout).
- Nixpacks/build failures are visible in the dashboard build logs.

## Non-goals

- Cloud Native Buildpacks / Paketo support.
- Auto-detecting build mode from repo contents (build mode is an explicit user
  choice; auto-detection can be a later enhancement).
- Custom Nixpacks configuration UI (users can still commit a `nixpacks.toml` to
  their repo; korepush passes the repo through unchanged).

## Decisions (from brainstorming)

- **Build-mode selection:** explicit choice in the UI (`buildMode` on the
  project), not auto-detection.
- **Nixpacks delivery:** bake our own pinned Nixpacks image, published to GHCR by
  the existing CI, referenced via an env var.
- **Integration point:** an extra init container in the *same* build Job (approach
  A), reusing the existing git-clone → BuildKit flow.

## Architecture

The build Job today:

```
initContainers: [git-clone]   # clones repo into shared /workspace emptyDir
containers:     [builder]     # rootless BuildKit: buildctl build → push image
```

In Nixpacks mode it becomes:

```
initContainers: [git-clone, nixpacks-prep]
containers:     [builder]
```

- `git-clone` (unchanged): clones the repo into `/workspace/repo`, owned by uid
  1000.
- `nixpacks-prep` (new, Nixpacks image): runs after git-clone, shares
  `/workspace`. Runs Nixpacks to **generate a Dockerfile only** (no docker build)
  into `/workspace/repo/.nixpacks/Dockerfile`.
- `builder` (unchanged container, different args in nixpacks mode): BuildKit
  builds with `context=/workspace/repo`, `dockerfile=/workspace/repo/.nixpacks`,
  `filename=Dockerfile`, then pushes to the registry exactly as today.

Init containers run sequentially in declaration order, so `nixpacks-prep` is
guaranteed to see the cloned repo. The shared `emptyDir` (`/workspace`) carries
the generated Dockerfile to the builder. `fsGroup`/`runAsUser` 1000 already make
the workspace writable by both.

> Implementation detail to confirm against the pinned Nixpacks version: the exact
> CLI invocation for "generate the Dockerfile but do not build" (expected:
> `nixpacks build /workspace/repo --out /workspace/repo`, which writes
> `/workspace/repo/.nixpacks/Dockerfile` and skips the docker build). The plan
> must verify this.

## Components

### 1. Data model

- `projects.buildMode` (exists, default `"dockerfile"`): now also accepts
  `"nixpacks"`. Free-text column; validity is enforced in app code (Zod enum).
- `deployments.buildMode` (**new** column): snapshot of the project's build mode
  at deploy time, alongside the existing `dockerfilePath`/`buildContext`/
  `buildTarget` snapshot. Keeps a deploy reproducible if the project mode changes.
- One Drizzle migration adds `deployments.build_mode` (NOT NULL default
  `'dockerfile'`).

### 2. Nixpacks image

- New build context: `docker/nixpacks/Dockerfile` — slim base + a **pinned**
  Nixpacks binary fetched from the `railwayapp/nixpacks` GitHub release at image
  build time.
- Published to GHCR by the existing CI workflow as `korepush2-nixpacks`
  (same repo-scoped naming as web/worker).
- Referenced by a new `NIXPACKS_IMAGE` env var in `apps/worker/src/env.ts`,
  defaulting to the pinned GHCR tag — mirrors the existing `BUILD_IMAGE` pattern.

### 3. Build Job (worker)

- `apps/worker/src/k8s/build-job.ts`:
  - `BuildJobArgs` gains `buildMode: "dockerfile" | "nixpacks"` and
    `nixpacksImage?: string`.
  - When `buildMode === "nixpacks"`: append the `nixpacks-prep` init container
    (image = `nixpacksImage`, mounts `/workspace`, runs the generate-only
    command) and override the BuildKit args to point at
    `/workspace/repo/.nixpacks/Dockerfile`. The project's `dockerfilePath` is
    ignored in this mode.
  - `nixpacks-prep` inherits the pod-level `runAsUser: 1000` security context, so
    it writes the generated files as uid 1000 (readable by the builder).
- `apps/worker/src/handlers/deploy-project.ts`: read `deployment.buildMode`, pass
  it plus `env.nixpacksImage` into `buildJobManifest`. Everything downstream
  (registry push, deployment/service/ingress, `PORT` injection, rollout) is
  unchanged. The runtime already injects `PORT=project.port`, which Nixpacks apps
  honor.

### 4. UI + API

- `apps/web/app/dashboard/projects/new/new-project-form.tsx`: a build-mode toggle
  ("Dockerfile" / "Nixpacks (auto-detect)"). In Nixpacks mode, hide the
  Dockerfile-path field (build context remains available).
- `apps/web/app/dashboard/projects/[projectId]/settings/settings-form.tsx`: same
  toggle so an existing project can switch modes.
- `POST /api/projects` and the project settings update route: accept `buildMode`
  (Zod enum `dockerfile | nixpacks`); **skip `validateDockerfilePath`** when mode
  is `nixpacks`.

### 5. Error handling / diagnosability

- Today `collectJobLogs` (`apps/worker/src/k8s/logs.ts`) reads only the `builder`
  container, so any init-container failure (clone, and now nixpacks-prep) shows
  "No logs yet". This design **includes** collecting the init containers'
  (`git-clone`, `nixpacks-prep`) logs into the deployment build log on failure,
  so Nixpacks detection/generation errors are visible. This subsumes the
  separately-flagged init-log diagnosability fix.
- If Nixpacks cannot detect a stack, its non-zero exit fails `nixpacks-prep`; the
  failure reason + its stderr now surface in the dashboard.

## Data flow (nixpacks deploy)

1. User sets project `buildMode = nixpacks` (create or settings).
2. Deploy enqueues a `deploy.project` job; `deployments.buildMode` is snapshotted.
3. Worker builds the Job manifest with the `nixpacks-prep` init container and
   nixpacks Dockerfile path.
4. `git-clone` clones the repo → `nixpacks-prep` generates
   `.nixpacks/Dockerfile` → `builder` (BuildKit) builds & pushes the image.
5. Worker applies Deployment/Service/Ingress and waits for rollout (unchanged).
6. On any build failure, init + builder logs are collected into the build log.

## Testing

- No automated test framework exists in the repo; this work will not introduce
  one.
- Verification:
  - `pnpm --filter @korepush/worker typecheck` and web typecheck.
  - A manifest sanity check: in nixpacks mode the generated Job includes the
    `nixpacks-prep` init container and the overridden
    `.nixpacks/Dockerfile` path; in dockerfile mode the manifest is unchanged.
  - Manual end-to-end in the OrbStack VM: set `ecomdesignlab` to Nixpacks mode,
    redeploy, and confirm clone → nixpacks-prep generates Dockerfile → BuildKit
    builds → image pushed → rollout ready, with logs visible throughout.

## Rollout

- New Nixpacks image must be built/published before the worker defaults to it;
  CI change + worker change ship together. `NIXPACKS_IMAGE` is overridable for
  pinning/air-gapped installs.
- Backwards compatible: existing projects remain `buildMode = dockerfile` and are
  unaffected.
