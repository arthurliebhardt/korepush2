# Railpack builds (replacing Nixpacks) for Dockerfile-less repos

**Date:** 2026-05-28
**Status:** Approved — ready for implementation planning
**Supersedes:** the Nixpacks build mode shipped in `docs/superpowers/specs/2026-05-28-nixpacks-buildkit-builds-design.md`

## Problem / motivation

korepush just shipped a `nixpacks` build mode so Dockerfile-less repos can deploy.
Railpack (`railwayapp/railpack`) is Railway's official successor to Nixpacks — it
incorporates production learnings from Nixpacks, has more current language/runtime
defaults (the Nixpacks e2e failed because Nixpacks defaulted an app to EOL Node 18),
and is designed as a **BuildKit gateway frontend**, which fits korepush's existing
rootless-BuildKit build Job more naturally than Nixpacks' generate-a-Dockerfile model.

Since the Nixpacks mode is brand-new and not in real use, we **replace** it with
Railpack rather than carrying two auto-builders.

## Goals

- A project can build with Railpack instead of a committed Dockerfile.
- Railpack auto-detects the stack, and the build runs through korepush's existing
  in-cluster build Job (clone → build → push → rollout) — unchanged downstream.
- Exactly one auto-builder (Railpack); all Nixpacks-specific code is removed.

## Non-goals

- Keeping Nixpacks as a parallel option.
- Custom Railpack configuration UI (users can commit a `railpack.json` to their repo;
  korepush passes the repo through unchanged).
- Mirroring the Railpack frontend image into the in-cluster registry (we pull a pinned
  image from GHCR at build time).

## Decisions (from brainstorming)

- **Replace** the `nixpacks` build mode with `railpack` (rename the enum value, migrate
  the one existing row).
- **Integration model:** Railpack's documented platform-integration path —
  `railpack prepare` generates a plan, then our existing builder consumes it via the
  BuildKit **gateway frontend**. (Rejected alternative: `railpack build`, which spins up
  its own BuildKit and bypasses our registry-push/rollout wiring.)
- **Railpack CLI** comes from our own pinned image, published via CI (same pattern as the
  Nixpacks image it replaces).
- **Railpack frontend image** is pulled pinned from GHCR at build time
  (`ghcr.io/railwayapp/railpack-frontend`), consistent with how the builder already pulls
  `moby/buildkit` and `alpine/git`.

## How Railpack integrates (grounded in current docs)

Railpack's platform-integration flow:

1. `railpack prepare --plan-out railpack-plan.json <dir>` — analyzes the source and
   writes a `railpack-plan.json` build plan. No Docker daemon required (plan-only).
2. BuildKit builds using Railpack's gateway frontend:
   ```
   buildctl build \
     --frontend gateway.v0 \
     --opt source=ghcr.io/railwayapp/railpack-frontend:<pinned> \
     --local context=<dir> \
     --local dockerfile=<dir-containing-plan> \
     --opt filename=railpack-plan.json \
     --output type=image,name=<dest>,push=true[,registry.insecure=true]
   ```

Contrast with the Nixpacks model being replaced: Nixpacks' prep generated a **Dockerfile**
and the builder used the built-in `dockerfile.v0` frontend. Railpack's prep generates a
**plan.json** and the builder uses `gateway.v0` pointed at the Railpack frontend image
(which BuildKit pulls at build time — the one genuinely new wrinkle, since `dockerfile.v0`
is built in).

## Architecture

The build Job today (post-Nixpacks):

```
initContainers: [git-clone]          # always
                [git-clone, <prep>]  # auto-build modes
containers:     [builder]            # rootless BuildKit
```

Railpack mode:

```
initContainers: [git-clone, railpack-prep]
containers:     [builder]   # buildctl gateway.v0 → railpack-frontend, consumes plan
```

- `git-clone` (unchanged): clones into `/workspace/repo`, owned by uid 1000.
- `railpack-prep` (new, our Railpack CLI image): runs after git-clone, shares
  `/workspace`, runs `railpack prepare --plan-out /workspace/repo/railpack-plan.json
  /workspace/repo`. Runs as uid 1000 (pod securityContext), like git-clone.
- `builder` (same container, railpack-mode args): `--frontend gateway.v0`,
  `--opt source=$RAILPACK_FRONTEND_IMAGE`, `--local context=/workspace/repo`,
  `--local dockerfile=/workspace/repo`, `--opt filename=railpack-plan.json`. Output/push/
  `registry.insecure` and everything downstream (deploy/service/ingress/rollout, `PORT`
  injection) unchanged.

## Components

### 1. Data model + migration

- `packages/shared/src/constants.ts`: `BUILD_MODES = ["dockerfile", "railpack"] as const`
  (drop `"nixpacks"`). `BuildMode` type in `types.ts` derives from it (already there).
- Drizzle migration: a data migration renaming existing values —
  `UPDATE projects SET build_mode='railpack' WHERE build_mode='nixpacks';` and the same for
  `deployments`. The `build_mode` columns themselves already exist (default `'dockerfile'`).

### 2. Railpack CLI image (replaces the Nixpacks image)

- New `docker/railpack/Dockerfile`: slim base + a **pinned** `railpack` binary fetched from
  the `railwayapp/railpack` GitHub release at image-build time, multi-arch via `TARGETARCH`.
- Published to GHCR by CI as `…-railpack` (matching the repo-scoped naming of web/worker).
- Delete `docker/nixpacks/Dockerfile` and its CI matrix entry.

### 3. Worker env

- Replace `nixpacksImage` with:
  - `railpackImage` (env `RAILPACK_IMAGE`, default the pinned GHCR `…-railpack` tag) — the
    prep CLI image.
  - `railpackFrontendImage` (env `RAILPACK_FRONTEND_IMAGE`, default a pinned
    `ghcr.io/railwayapp/railpack-frontend` tag) — the gateway frontend.

### 4. Build Job (worker)

- `apps/worker/src/k8s/build-job.ts`: `BuildJobArgs.buildMode` stays `BuildMode`; replace
  `nixpacksImage?` with `railpackImage?` + `railpackFrontendImage?`. When
  `buildMode === "railpack"`: append the `railpack-prep` init container (throws if
  `railpackImage`/`railpackFrontendImage` missing) and switch the builder's frontend args to
  the `gateway.v0` form above (plan filename `railpack-plan.json`, context = repo root). The
  `NIXPACKS_OUT_DIR`/`nixpacks-prep` logic is replaced wholesale.
- `apps/worker/src/handlers/deploy-project.ts`: pass `railpackImage`/`railpackFrontendImage`;
  the init-log failure loop becomes `["git-clone", "railpack-prep"]` in railpack mode.
- `apps/worker/src/k8s/logs.ts` init-container tolerance: unchanged (already handles any init
  container).

### 5. API + UI

- Zod enums become `z.enum(["dockerfile", "railpack"])` in project create + PATCH; Dockerfile-
  path validation still skipped in non-dockerfile mode; build context still always validated.
- Deployment snapshot + rollback snapshot of `buildMode`: unchanged (already added).
- UI toggle label `"Nixpacks (auto-detect)"` → `"Railpack (auto-detect)"`, helper text updated,
  in both the new-project form and settings form. Dockerfile-path field still hidden in the
  auto-build mode.

### 6. Cleanup

- Remove every Nixpacks reference: `docker/nixpacks/`, `NIXPACKS_IMAGE` env, `nixpacks-prep`,
  `NIXPACKS_OUT_DIR`, the CI matrix `nixpacks` entry, UI strings, and comments. End state: one
  auto-builder.

## Data flow (railpack deploy)

1. User sets project `buildMode = railpack`.
2. Deploy enqueues; `deployments.buildMode` snapshots `railpack`.
3. Worker builds the Job: `git-clone` → `railpack-prep` (writes `railpack-plan.json`) →
   `builder` (gateway frontend consumes the plan, builds, pushes).
4. Apply Deployment/Service/Ingress + rollout (unchanged). `PORT` is already injected.
5. On any failure, init + builder logs are collected into the build log.

## Error handling

- `railpack-prep` failures (unsupported stack, prepare error) surface via the existing
  init-container log collection.
- Gateway-frontend / build failures appear in the `builder` logs as today.

## Testing

- No automated test framework in the repo; none introduced.
- Verification:
  - `pnpm --filter @korepush/worker typecheck`, shared, db, and `web` `tsc --noEmit`.
  - Ad-hoc manifest check: railpack mode ⇒ Job has `railpack-prep` init container and the
    builder args use `--frontend gateway.v0`, `source=<frontend image>`,
    `filename=railpack-plan.json`; dockerfile mode unchanged.
  - VM e2e: set ecomdesignlab to Railpack, redeploy; confirm clone → `railpack prepare`
    generates the plan → gateway-frontend build → image pushed → rollout ready, with logs
    visible. Confirm Railpack's defaults pick a supported runtime (no EOL-Node failure); any
    remaining version pin is repo config (non-goal).

## Open items to verify during implementation (flagged, not blocking)

- Exact `railpack prepare` invocation/flags and confirmation it is daemon-free (run
  `railpack prepare --help` in the built CLI image; smoke-test plan generation with no daemon).
- Whether the gateway frontend requires `--opt build-arg:secrets-hash` / `cache-key` opts, or
  builds without them (start without; add if the frontend errors).
- Pinned versions: the `railpack` CLI release **and** a compatible `railpack-frontend`
  tag/digest (ideally matching versions); confirm both exist for linux/amd64 + arm64.

## Rollout

- CI must publish the new `…-railpack` image; worker defaults to it. `RAILPACK_IMAGE` and
  `RAILPACK_FRONTEND_IMAGE` are overridable for pinning/air-gapped installs.
- The data migration flips existing `nixpacks` rows to `railpack`. Existing `dockerfile`
  projects are unaffected.
