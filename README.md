# Korepush

Self-hosted PaaS for your own server. Install with one script, deploy apps from Git through
a web dashboard backed by K3s.

## Repo layout

```
apps/
  web/          Next.js dashboard (App Router, Better Auth, Server Components)
  worker/       TypeScript worker — claims jobs and writes to the K8s API
packages/
  db/           Drizzle ORM schema + migrations (Postgres)
  queue/        Postgres-backed job queue (FOR UPDATE SKIP LOCKED)
  crypto/       AES-256-GCM envelope encryption + setup-token hashing
  shared/       Types, label builders, slug/path validation, naming conventions
  ui/           Shared React UI primitives (Tailwind-based)
  tsconfig/     Shared tsconfigs
installer/
  install.sh    One-line installer (K3s, Postgres, registry, web, worker)
  manifests/    Standalone K8s manifests
```

## Architecture

```
User
  └─ Next.js dashboard (apps/web)
       └─ Postgres (Drizzle)
            └─ jobs table
                 └─ Worker loop (apps/worker)
                      └─ Kubernetes API
                           └─ Build Jobs (BuildKit)
                           └─ Deployments / Services / Ingresses
```

The web app **never performs deployment work** in HTTP handlers. It writes a
`deployments` row plus a `jobs` row and returns immediately; the worker does the
heavy lifting and updates status, events, and build logs.

## Local development

### Full stack in a local Kubernetes (recommended)

Mirrors the VPS install — Postgres, registry, web, worker, the lot — but on
your laptop. Works with either [OrbStack](https://orbstack.dev) (enable
Settings → Kubernetes → ON) or [k3d](https://k3d.io) (`brew install k3d`).

```sh
./dev/up.sh
# … 5 min first time (image build) …
# ✓ Korepush is up:
#     http://localhost:8000
```

Useful sub-commands:

```sh
./dev/up.sh logs            # tail web + worker
SKIP_BUILD=1 ./dev/up.sh    # re-apply manifests without rebuilding images
PORT=9000 ./dev/up.sh       # use a different host port
./dev/up.sh down            # delete the korepush namespace (keeps cluster)
./dev/up.sh nuke            # also delete the k3d cluster
```

### End-to-end test of the VPS installer

`dev/test-installer.sh` spawns a fresh `ubuntu:24.04` microVM (OrbStack or
multipass), runs the live `curl … | sudo bash` install in it, and polls the
dashboard until it answers — then tears the VM down. Catches any regression
in the install path on a clean OS.

```sh
./dev/test-installer.sh           # spin up, install, verify, destroy
./dev/test-installer.sh --keep    # leave the VM around for debugging
./dev/test-installer.sh --ref my-branch   # test a specific ref of the installer
```

### Web app only (fastest iteration)

Run Postgres in Docker and the Next.js dashboard / worker directly with `pnpm
dev` against it. Hot-reload, no image builds. The worker's K8s calls won't
have a real cluster to talk to, so the deploy flow won't work — but everything
else (auth, projects, env vars, domains UI) does.

```sh
docker run -d --name korepush-pg \
  -e POSTGRES_USER=korepush -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=korepush \
  -p 5432:5432 postgres:16-alpine

pnpm install
cp .env.example .env   # fill secrets (see below)
pnpm db:migrate
pnpm dev               # runs web + worker via turbo
```

Generate the secrets:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Install on a VPS

On a fresh Ubuntu 22.04 / 24.04 / 26.04 / Debian 12 VPS, one command:

```sh
curl -fsSL https://raw.githubusercontent.com/arthurliebhardt/korepush2/main/installer/install.sh | sudo bash
```

That's it. No clone, no `cd`, no flags. The installer:

1. Detects the OS and checks resources (≥2 vCPU, ≥2GB RAM, ≥20GB disk).
2. Installs K3s and git (Docker only installed if it has to build).
3. Clones this repo to `/var/lib/korepush/source`.
4. **Pulls the published images from `ghcr.io/arthurliebhardt/...`** straight
   into K3s containerd — install takes ~30 sec total. Falls back to building
   from source if the images aren't published (or aren't public) yet.
5. Installs cert-manager (skipped without `--email`).
6. Generates platform secrets, deploys Postgres + registry + RBAC + web + worker.
7. Runs DB migrations.
8. Prints the dashboard URL.

Open the URL. The first visitor to `/setup` becomes Owner — open it before
sharing the address. Once an admin exists, `/setup` refuses further sign-ups.

### With HTTPS and a custom domain

Point a DNS A record at your VPS first, then:

```sh
curl -fsSL https://raw.githubusercontent.com/arthurliebhardt/korepush2/main/installer/install.sh \
  | sudo bash -s -- --domain panel.example.com --email you@example.com
```

### Pinning to a specific image tag

```sh
curl -fsSL https://raw.githubusercontent.com/arthurliebhardt/korepush2/main/installer/install.sh \
  | sudo bash -s -- \
      --web-image ghcr.io/arthurliebhardt/korepush2-web:v1.0.0 \
      --worker-image ghcr.io/arthurliebhardt/korepush2-worker:v1.0.0
```

### From a local clone (for development on the VPS)

```sh
git clone https://github.com/arthurliebhardt/korepush2.git
cd korepush2
sudo ./installer/install.sh --yes
```

### One-time GHCR setup

The bundled `.github/workflows/images.yml` builds and pushes
`ghcr.io/arthurliebhardt/korepush-{web,worker}` on every push to `main`. The
first time, you must **make the packages public** in the GitHub UI (Profile →
Packages → each → Settings → Change visibility → Public), or the installer
can't pull them and will fall back to building from source on the VPS.

The installer detects it's running inside a checkout and uses it directly.

The installer clones `KORE_REPO` (`--repo`) into `/var/lib/korepush/source`,
then either pulls the published images or builds.

### Update / uninstall

```sh
sudo ./installer/install.sh update                  # pull/rebuild, redeploy
sudo ./installer/install.sh uninstall               # remove platform only
sudo ./installer/install.sh uninstall --purge --yes # also remove DB, registry, projects
```

## How a deploy works

1. User clicks Deploy.
2. `POST /api/projects/:id/deployments` inserts a `deployments` row (status=`queued`)
   and a `deploy.project` job. Returns `{ deploymentId, jobId }`.
3. The worker claims the job with `SELECT ... FOR UPDATE SKIP LOCKED`.
4. Worker validates Dockerfile path / build context, ensures the namespace, and
   creates a rootless BuildKit Job that clones the repo with an init container,
   then runs `buildctl-daemonless.sh` to build the Dockerfile and push to the
   internal registry.
5. Worker polls build status, persists logs into `build_logs`, and records
   events into `deployment_events`.
6. On success, worker decrypts environment variables, writes the Kubernetes
   Secret, applies Deployment / Service / Ingress, and watches the rollout.
7. Status flips through `building → deploying → ready`. Every managed
   Kubernetes object is recorded in `k8s_resources` with a stable hash for
   future drift detection and CRD/operator migration.

## Labels

Every managed K8s object carries:

```
app.kubernetes.io/name        = <projectSlug>
app.kubernetes.io/instance    = <environmentSlug>
app.kubernetes.io/component   = web | build | worker | system
app.kubernetes.io/part-of     = <projectSlug>
app.kubernetes.io/managed-by  = korepush
korepush.dev/project-id       = <projectId>
korepush.dev/environment-id   = <environmentId>
korepush.dev/deployment-id    = <deploymentId>   # when applicable
```

## Future migration to CRD/operator

`packages/db` already records every applied K8s object with a `spec_hash`. The
worker can be replaced with an operator that watches an `AppDeployment` CRD
without changing the dashboard or data model.
