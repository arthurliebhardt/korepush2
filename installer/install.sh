#!/usr/bin/env bash
#
# Korepush installer.
#
# Quick install on a fresh Ubuntu/Debian VPS:
#
#   curl -fsSL https://install.korepush.dev | sudo bash
#
# Or, from a cloned repo:
#
#   git clone https://github.com/<you>/korepush.git
#   cd korepush
#   sudo ./installer/install.sh
#
# What it does:
#   1. Detects supported OS and checks resources.
#   2. Installs K3s, Docker, git (only what's missing).
#   3. Clones the source (or reuses the current checkout).
#   4. Builds the web + worker images locally and imports them into K3s.
#   5. Deploys Postgres, registry, RBAC, cert-manager, web, worker.
#   6. Runs DB migrations.
#   7. Prints the dashboard URL — first visitor becomes Owner.
#
set -euo pipefail

# ---- defaults --------------------------------------------------------------
PLATFORM_NAMESPACE="${PLATFORM_NAMESPACE:-korepush-system}"
DATA_DIR="${DATA_DIR:-/var/lib/korepush}"

# >>> EDIT THIS ONE LINE AFTER FORKING <<<
# Point this at your fork. The GHA workflow at .github/workflows/images.yml will
# publish images to ghcr.io/<owner>/korepush-{web,worker} on every push to main,
# and this installer will auto-pull them. The "owner" is inferred from this URL.
KORE_REPO="${KORE_REPO:-https://github.com/arthurliebhardt/korepush2.git}"
KORE_REF="${KORE_REF:-main}"
SOURCE_DIR="${KORE_SOURCE_DIR:-}"

INGRESS_CLASS="${INGRESS_CLASS:-traefik}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.16.1}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
REGISTRY_IMAGE="${REGISTRY_IMAGE:-registry:2.8.3}"

WEB_IMAGE="${WEB_IMAGE:-}"
WORKER_IMAGE="${WORKER_IMAGE:-}"

DOMAIN=""
ADMIN_EMAIL=""
EFFECTIVE_HOST=""   # computed: DOMAIN, or <vps-ip>.sslip.io fallback
EFFECTIVE_SCHEME="" # http when sslip.io, https when --email + --domain
PUBLIC_IP=""
SKIP_K3S=false
SKIP_CERT_MANAGER=false
INSTALL_REGISTRY=true
INSTALL_POSTGRES=true
ASSUME_YES=false
COMMAND="install"
PURGE=false

# ---- ui helpers ------------------------------------------------------------
GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[0;33m'; BLU=$'\033[0;34m'; OFF=$'\033[0m'
log()  { printf "%s==>%s %s\n" "$BLU" "$OFF" "$*"; }
ok()   { printf "%s ✓%s %s\n" "$GREEN" "$OFF" "$*"; }
warn() { printf "%s ⚠%s %s\n" "$YEL" "$OFF" "$*"; }
err()  { printf "%s ✗%s %s\n" "$RED" "$OFF" "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  cat <<EOF
Korepush installer

Commands:
  install              Install Korepush (default)
  update               Pull / rebuild and roll out new images
  uninstall            Uninstall Korepush
    --purge            Also remove databases, registry, project namespaces

Install options:
  --domain HOST        Public dashboard hostname (e.g. panel.example.com)
  --email ADDR         Admin email (for Let's Encrypt)
  --repo URL           Git repo to build from. Default: $KORE_REPO
  --ref REF            Git ref (branch / tag / sha). Default: $KORE_REF
  --source-dir PATH    Use an existing source checkout (skip git clone)
  --web-image IMAGE    Use a pre-built web image (skip docker build)
  --worker-image IMAGE Use a pre-built worker image (skip docker build)
  --skip-k3s           Don't install K3s (use existing cluster)
  --skip-cert-manager  Don't install cert-manager
  --data-dir PATH      Persistent storage root (default: $DATA_DIR)
  --yes, -y            Non-interactive, assume yes

Env var equivalents: KORE_REPO, KORE_REF, KORE_SOURCE_DIR, WEB_IMAGE,
WORKER_IMAGE, PLATFORM_NAMESPACE.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      install|update|uninstall) COMMAND="$1"; shift ;;
      --purge) PURGE=true; shift ;;
      --domain) DOMAIN="$2"; shift 2 ;;
      --email) ADMIN_EMAIL="$2"; shift 2 ;;
      --repo) KORE_REPO="$2"; shift 2 ;;
      --ref) KORE_REF="$2"; shift 2 ;;
      --source-dir) SOURCE_DIR="$2"; shift 2 ;;
      --web-image) WEB_IMAGE="$2"; shift 2 ;;
      --worker-image) WORKER_IMAGE="$2"; shift 2 ;;
      --skip-k3s) SKIP_K3S=true; shift ;;
      --skip-cert-manager) SKIP_CERT_MANAGER=true; shift ;;
      --data-dir) DATA_DIR="$2"; shift 2 ;;
      --yes|-y) ASSUME_YES=true; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown argument: $1 (try --help)" ;;
    esac
  done
}

require_root() {
  if [[ $EUID -ne 0 ]]; then
    if ! command -v sudo >/dev/null; then die "Run as root or install sudo"; fi
    log "Re-exec under sudo"
    exec sudo -E bash "$0" "$@"
  fi
}

detect_os() {
  [[ -f /etc/os-release ]] || die "Cannot detect OS"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "$ID-$VERSION_ID" in
    ubuntu-22.04|ubuntu-24.04|ubuntu-26.04|debian-12) ok "Detected $PRETTY_NAME" ;;
    *) die "Unsupported OS: $PRETTY_NAME. Supported: Ubuntu 22.04, 24.04, 26.04, Debian 12." ;;
  esac
}

check_requirements() {
  local cores mem_mb disk_gb
  cores=$(nproc)
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  disk_gb=$(df -BG --output=avail / | awk 'NR==2 {gsub(/G/,""); print int($1)}')
  [[ "$cores"   -ge 2    ]] || die "Need >=2 CPU cores (have $cores)"
  [[ "$mem_mb"  -ge 1800 ]] || die "Need >=2GB RAM (have ${mem_mb}MB)"
  [[ "$disk_gb" -ge 20   ]] || die "Need >=20GB free disk (have ${disk_gb}G)"
  for bin in curl ss openssl awk sed; do
    command -v "$bin" >/dev/null || die "Missing required binary: $bin"
  done
  ok "Requirements OK (${cores} cores, ${mem_mb}MB RAM, ${disk_gb}GB disk)"
  if ss -ltn '( sport = :80 or sport = :443 )' 2>/dev/null | grep -q LISTEN; then
    warn "Ports 80/443 appear to be in use. K3s/Traefik will attempt to bind anyway."
  fi
}

# ---- prerequisites ---------------------------------------------------------
install_apt_pkg_if_needed() {
  local bin="$1" pkg="${2:-$1}"
  command -v "$bin" >/dev/null && return
  log "Installing $pkg"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg"
}

install_docker_if_needed() {
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    ok "Docker already running"
    return
  fi
  log "Installing Docker (via official convenience script)"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  ok "Docker installed"
}

install_k3s() {
  if $SKIP_K3S; then ok "K3s install skipped (--skip-k3s)"; return; fi
  if command -v k3s >/dev/null; then
    ok "K3s already installed"
  else
    log "Installing K3s"
    INSTALL_K3S_EXEC="--write-kubeconfig-mode 644 --disable=local-storage" \
      curl -fsSL https://get.k3s.io | sh -
  fi
  log "Waiting for K3s to be ready"
  local kc=/etc/rancher/k3s/k3s.yaml
  for _ in {1..60}; do
    if KUBECONFIG=$kc kubectl get nodes >/dev/null 2>&1; then ok "K3s up"; break; fi
    sleep 2
  done
  export KUBECONFIG=$kc
}

# ---- source + image build --------------------------------------------------
detect_or_clone_source() {
  if [[ -n "$SOURCE_DIR" ]]; then
    [[ -d "$SOURCE_DIR/apps/web" ]] || die "--source-dir $SOURCE_DIR missing apps/web"
    ok "Using source at $SOURCE_DIR"
    return
  fi

  # If we were invoked from inside a checkout (./installer/install.sh), use it.
  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    local script_dir candidate
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    candidate="$(cd "$script_dir/.." 2>/dev/null && pwd)" || true
    if [[ -d "$candidate/apps/web" && -d "$candidate/apps/worker" && -d "$candidate/packages/db" ]]; then
      SOURCE_DIR="$candidate"
      ok "Using local source checkout at $SOURCE_DIR"
      return
    fi
  fi

  install_apt_pkg_if_needed git
  SOURCE_DIR="$DATA_DIR/source"
  mkdir -p "$DATA_DIR"

  if [[ -d "$SOURCE_DIR/.git" ]]; then
    log "Updating source at $SOURCE_DIR ($KORE_REF)"
    git -C "$SOURCE_DIR" remote set-url origin "$KORE_REPO"
    git -C "$SOURCE_DIR" fetch --depth 1 origin "$KORE_REF"
    git -C "$SOURCE_DIR" checkout -q FETCH_HEAD
  else
    log "Cloning $KORE_REPO ($KORE_REF) -> $SOURCE_DIR"
    git clone --depth 1 -b "$KORE_REF" "$KORE_REPO" "$SOURCE_DIR" \
      || die "Failed to clone $KORE_REPO. Pass --repo or --source-dir."
  fi
  ok "Source ready"
}

# Try to pull pre-built images from ghcr.io. The repo's git origin tells us
# which GHCR namespace to check. If both images pull, we skip the Docker build
# entirely — install drops from ~10 min to ~30 sec.
#
# Requires the images to be public; otherwise the user can pass --web-image /
# --worker-image with credentials wired in separately.
try_pull_published_images() {
  if [[ -n "$WEB_IMAGE" && -n "$WORKER_IMAGE" ]]; then return; fi

  local owner="" repo=""
  if [[ -d "$SOURCE_DIR/.git" ]]; then
    local origin
    origin="$(git -C "$SOURCE_DIR" remote get-url origin 2>/dev/null || true)"
    # Match https://github.com/owner/repo[.git] or git@github.com:owner/repo[.git]
    if [[ "$origin" =~ github\.com[/:]([^/]+)/([^/.]+)(\.git)?$ ]]; then
      owner="${BASH_REMATCH[1]}"
      repo="${BASH_REMATCH[2]}"
    fi
  fi
  if [[ -z "$owner" || -z "$repo" ]]; then
    log "No GitHub origin detected — will build images from source"
    return
  fi

  # GHCR is lower-case only. Image names match the workflow:
  # ghcr.io/<owner>/<repo>-{web,worker}.
  local owner_lc="${owner,,}"
  local repo_lc="${repo,,}"
  local tag="$KORE_REF"
  [[ "$KORE_REF" == "main" ]] && tag="latest"

  local web_candidate="ghcr.io/${owner_lc}/${repo_lc}-web:${tag}"
  local worker_candidate="ghcr.io/${owner_lc}/${repo_lc}-worker:${tag}"

  log "Looking for published images at ghcr.io/${owner_lc}/${repo_lc}-{web,worker}:${tag}"
  if k3s ctr images pull "$web_candidate" >/dev/null 2>&1 \
     && k3s ctr images pull "$worker_candidate" >/dev/null 2>&1; then
    WEB_IMAGE="$web_candidate"
    WORKER_IMAGE="$worker_candidate"
    ok "Pulled $WEB_IMAGE"
    ok "Pulled $WORKER_IMAGE"
  else
    log "No published images for ${owner_lc} — will build from source"
    log "(Push to GitHub to trigger the build-and-publish workflow, then re-run.)"
  fi
}

build_and_import_images() {
  if [[ -n "$WEB_IMAGE" && -n "$WORKER_IMAGE" ]]; then
    ok "Using image: $WEB_IMAGE / $WORKER_IMAGE"
    return
  fi

  install_docker_if_needed

  : "${WEB_IMAGE:=korepush-web:local}"
  : "${WORKER_IMAGE:=korepush-worker:local}"

  log "Building $WEB_IMAGE (this takes 5-10 min on first run)"
  ( cd "$SOURCE_DIR" && docker build -t "$WEB_IMAGE" -f apps/web/Dockerfile . ) \
    || die "web image build failed"

  log "Building $WORKER_IMAGE"
  ( cd "$SOURCE_DIR" && docker build -t "$WORKER_IMAGE" -f apps/worker/Dockerfile . ) \
    || die "worker image build failed"

  log "Importing images into K3s containerd"
  docker save "$WEB_IMAGE"    | k3s ctr images import -
  docker save "$WORKER_IMAGE" | k3s ctr images import -
  ok "Images built and imported"
}

# Pull policy: Never for locally-imported images (no registry exists for them),
# IfNotPresent for everything else.
image_pull_policy_for() {
  local img="$1"
  if [[ "$img" == *":local" || "$img" == *":dev" ]]; then
    echo "Never"
  else
    echo "IfNotPresent"
  fi
}

# ---- k8s resources ---------------------------------------------------------
create_namespace() {
  kubectl get ns "$PLATFORM_NAMESPACE" >/dev/null 2>&1 || kubectl create ns "$PLATFORM_NAMESPACE"
  ok "Namespace $PLATFORM_NAMESPACE ready"
}

install_cert_manager() {
  if $SKIP_CERT_MANAGER; then ok "cert-manager skipped"; return; fi
  if kubectl get ns cert-manager >/dev/null 2>&1; then ok "cert-manager already present"; return; fi
  log "Installing cert-manager $CERT_MANAGER_VERSION"
  kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"
  kubectl wait --for=condition=Available --timeout=180s deployment -n cert-manager --all
}

apply_cluster_issuers() {
  if $SKIP_CERT_MANAGER; then return; fi
  [[ -z "$ADMIN_EMAIL" ]] && { warn "No --email supplied; skipping ClusterIssuer creation"; return; }
  log "Applying ClusterIssuers"
  kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt-staging }
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: $ADMIN_EMAIL
    privateKeySecretRef: { name: letsencrypt-staging-key }
    solvers: [{ http01: { ingress: { class: $INGRESS_CLASS } } }]
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt-prod }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: $ADMIN_EMAIL
    privateKeySecretRef: { name: letsencrypt-prod-key }
    solvers: [{ http01: { ingress: { class: $INGRESS_CLASS } } }]
EOF
}

random_b64() { openssl rand -base64 "${1:-48}" | tr -d '\n'; }

# Pick the host the dashboard will be reachable at:
#   --domain <h>             → h, https when --email also given
#   nothing                  → <vps-ip>.sslip.io over http
# Coolify-style: works on a bare VPS with no DNS setup.
detect_public_ip() {
  # Prefer the IP a public resolver sees us as (handles NAT/cloud VPS).
  PUBLIC_IP="$(curl -fsSL --max-time 4 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$PUBLIC_IP" ]]; then
    PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  [[ -n "$PUBLIC_IP" ]] || die "Could not determine public IP. Pass --domain manually."
}

compute_effective_host() {
  detect_public_ip
  if [[ -n "$DOMAIN" ]]; then
    EFFECTIVE_HOST="$DOMAIN"
    if [[ -n "$ADMIN_EMAIL" ]] && ! $SKIP_CERT_MANAGER; then
      EFFECTIVE_SCHEME="https"
    else
      EFFECTIVE_SCHEME="http"
    fi
  else
    EFFECTIVE_HOST="${PUBLIC_IP}.sslip.io"
    EFFECTIVE_SCHEME="http"
  fi
  ok "Dashboard will be served at ${EFFECTIVE_SCHEME}://${EFFECTIVE_HOST}"
}

apply_platform_secrets() {
  log "Generating / reusing platform secrets"
  if kubectl -n "$PLATFORM_NAMESPACE" get secret korepush-db >/dev/null 2>&1; then
    ok "korepush-db secret already exists, reusing"
  else
    local db_pass; db_pass="$(random_b64 24 | tr -d '/+=')"
    kubectl -n "$PLATFORM_NAMESPACE" create secret generic korepush-db \
      --from-literal=POSTGRES_USER=korepush \
      --from-literal=POSTGRES_PASSWORD="$db_pass" \
      --from-literal=POSTGRES_DB=korepush
  fi

  if kubectl -n "$PLATFORM_NAMESPACE" get secret korepush-app >/dev/null 2>&1; then
    ok "korepush-app secret already exists, reusing"
  else
    local db_pass
    db_pass="$(kubectl -n "$PLATFORM_NAMESPACE" get secret korepush-db -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)"
    local auth_secret enc_key BAU
    auth_secret="$(random_b64 48)"
    enc_key="$(random_b64 48)"
    BAU="${EFFECTIVE_SCHEME}://${EFFECTIVE_HOST}"
    local DB_URL="postgres://korepush:${db_pass}@postgres.${PLATFORM_NAMESPACE}.svc.cluster.local:5432/korepush"
    kubectl -n "$PLATFORM_NAMESPACE" create secret generic korepush-app \
      --from-literal=DATABASE_URL="$DB_URL" \
      --from-literal=BETTER_AUTH_SECRET="$auth_secret" \
      --from-literal=BETTER_AUTH_URL="$BAU" \
      --from-literal=ENCRYPTION_KEY="$enc_key" \
      --from-literal=REGISTRY_URL="registry.${PLATFORM_NAMESPACE}.svc.cluster.local:5000" \
      --from-literal=PLATFORM_NAMESPACE="$PLATFORM_NAMESPACE"
  fi

  # Always reconcile BETTER_AUTH_URL — host may change between re-runs
  # (e.g. user added --domain after running once without it).
  local desired_bau="${EFFECTIVE_SCHEME}://${EFFECTIVE_HOST}"
  local current_bau
  current_bau="$(kubectl -n "$PLATFORM_NAMESPACE" get secret korepush-app \
    -o jsonpath='{.data.BETTER_AUTH_URL}' 2>/dev/null | base64 -d || true)"
  if [[ "$current_bau" != "$desired_bau" ]]; then
    log "Updating BETTER_AUTH_URL: ${current_bau:-<unset>} → $desired_bau"
    kubectl -n "$PLATFORM_NAMESPACE" patch secret korepush-app --type merge \
      -p "{\"stringData\":{\"BETTER_AUTH_URL\":\"$desired_bau\"}}"
    # Force a web rollout so the new env is picked up.
    kubectl -n "$PLATFORM_NAMESPACE" rollout restart deployment/web 2>/dev/null || true
  fi
}

apply_rbac() {
  log "Applying RBAC"
  kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: korepush-worker
  namespace: $PLATFORM_NAMESPACE
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: korepush-worker }
rules:
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get","list","watch","create","update","patch","delete"]
  - apiGroups: [""]
    resources: ["secrets","services","configmaps","serviceaccounts"]
    verbs: ["get","list","watch","create","update","patch","delete"]
  - apiGroups: [""]
    resources: ["pods","pods/log","events"]
    verbs: ["get","list","watch"]
  - apiGroups: ["apps"]
    resources: ["deployments","statefulsets","replicasets"]
    verbs: ["get","list","watch","create","update","patch","delete"]
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get","list","watch","create","update","patch","delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get","list","watch","create","update","patch","delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: korepush-worker }
subjects:
  - kind: ServiceAccount
    name: korepush-worker
    namespace: $PLATFORM_NAMESPACE
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: korepush-worker
EOF
}

apply_postgres() {
  if ! $INSTALL_POSTGRES; then ok "Postgres skipped"; return; fi
  log "Applying Postgres"
  kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: korepush-postgres, namespace: $PLATFORM_NAMESPACE }
spec:
  accessModes: ["ReadWriteOnce"]
  resources: { requests: { storage: 10Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: postgres, namespace: $PLATFORM_NAMESPACE }
spec:
  selector: { app.kubernetes.io/name: postgres }
  ports: [{ name: pg, port: 5432, targetPort: 5432 }]
  clusterIP: None
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: postgres, namespace: $PLATFORM_NAMESPACE }
spec:
  serviceName: postgres
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: postgres } }
  template:
    metadata: { labels: { app.kubernetes.io/name: postgres } }
    spec:
      containers:
        - name: postgres
          image: $POSTGRES_IMAGE
          ports: [{ containerPort: 5432 }]
          envFrom: [{ secretRef: { name: korepush-db } }]
          env:
            - { name: PGDATA, value: /var/lib/postgresql/data/pgdata }
          volumeMounts: [{ name: data, mountPath: /var/lib/postgresql/data }]
          readinessProbe:
            exec: { command: ["pg_isready","-U","korepush","-d","korepush"] }
            initialDelaySeconds: 5
            periodSeconds: 5
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: korepush-postgres }
EOF
  log "Waiting for Postgres to be ready"
  kubectl -n "$PLATFORM_NAMESPACE" rollout status statefulset/postgres --timeout=300s
}

apply_registry() {
  if ! $INSTALL_REGISTRY; then ok "Registry skipped"; return; fi
  log "Applying local registry"
  kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: korepush-registry, namespace: $PLATFORM_NAMESPACE }
spec:
  accessModes: ["ReadWriteOnce"]
  resources: { requests: { storage: 30Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: registry, namespace: $PLATFORM_NAMESPACE }
spec:
  selector: { app.kubernetes.io/name: registry }
  ports: [{ name: registry, port: 5000, targetPort: 5000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: registry, namespace: $PLATFORM_NAMESPACE }
spec:
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: registry } }
  template:
    metadata: { labels: { app.kubernetes.io/name: registry } }
    spec:
      containers:
        - name: registry
          image: $REGISTRY_IMAGE
          ports: [{ containerPort: 5000 }]
          env:
            - { name: REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY, value: /var/lib/registry }
          volumeMounts: [{ name: data, mountPath: /var/lib/registry }]
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: korepush-registry }
EOF
}

apply_migrations_job() {
  local pull_policy; pull_policy="$(image_pull_policy_for "$WORKER_IMAGE")"
  log "Running database migrations"
  local job="korepush-migrate-$(date +%s)"
  kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata: { name: $job, namespace: $PLATFORM_NAMESPACE }
spec:
  backoffLimit: 3
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrate
          image: $WORKER_IMAGE
          imagePullPolicy: $pull_policy
          command: ["./node_modules/.bin/tsx","./node_modules/@korepush/db/src/migrate.ts"]
          envFrom: [{ secretRef: { name: korepush-app } }]
EOF
  kubectl -n "$PLATFORM_NAMESPACE" wait --for=condition=complete --timeout=300s "job/$job" || \
    warn "Migration job did not complete in time. Check 'kubectl -n $PLATFORM_NAMESPACE logs job/$job'"
}

apply_web_and_worker() {
  local web_pull; web_pull="$(image_pull_policy_for "$WEB_IMAGE")"
  local wkr_pull; wkr_pull="$(image_pull_policy_for "$WORKER_IMAGE")"
  log "Applying web dashboard and worker"

  kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: web, namespace: $PLATFORM_NAMESPACE }
spec:
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: web } }
  template:
    metadata: { labels: { app.kubernetes.io/name: web } }
    spec:
      containers:
        - name: web
          image: $WEB_IMAGE
          imagePullPolicy: $web_pull
          ports: [{ containerPort: 3000 }]
          envFrom: [{ secretRef: { name: korepush-app } }]
          readinessProbe:
            httpGet: { path: /, port: 3000 }
            initialDelaySeconds: 10
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata: { name: web, namespace: $PLATFORM_NAMESPACE }
spec:
  selector: { app.kubernetes.io/name: web }
  ports: [{ name: http, port: 80, targetPort: 3000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: worker, namespace: $PLATFORM_NAMESPACE }
spec:
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: worker } }
  template:
    metadata: { labels: { app.kubernetes.io/name: worker } }
    spec:
      serviceAccountName: korepush-worker
      containers:
        - name: worker
          image: $WORKER_IMAGE
          imagePullPolicy: $wkr_pull
          envFrom: [{ secretRef: { name: korepush-app } }]
EOF

  # Always create an Ingress — without one nothing is reachable from outside
  # the cluster. Host is the effective domain (real domain or <ip>.sslip.io).
  local issuer_anno=""
  local tls_block=""
  if [[ "$EFFECTIVE_SCHEME" == "https" ]]; then
    issuer_anno=$'    cert-manager.io/cluster-issuer: letsencrypt-prod\n'
    tls_block="  tls:
    - hosts: [\"$EFFECTIVE_HOST\"]
      secretName: korepush-web-tls"
  fi
  kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: $PLATFORM_NAMESPACE
  annotations:
$issuer_anno    kubernetes.io/ingress.class: $INGRESS_CLASS
spec:
  ingressClassName: $INGRESS_CLASS
  rules:
    - host: $EFFECTIVE_HOST
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: web, port: { number: 80 } }
$tls_block
EOF

  kubectl -n "$PLATFORM_NAMESPACE" rollout status deployment/web    --timeout=180s || true
  kubectl -n "$PLATFORM_NAMESPACE" rollout status deployment/worker --timeout=180s || true
}

print_summary() {
  local url="${EFFECTIVE_SCHEME}://${EFFECTIVE_HOST}"
  cat <<EOF

${GREEN}Your Korepush is ready.${OFF}

Open this URL to create your admin account:
  $url

The first visitor to /setup becomes the Owner — open it now before sharing the
address. Once an admin exists, no further accounts can be self-created.

Next steps:
  1. Open the URL above
  2. Create your admin account
  3. Create a project from a Git repo with a Dockerfile
  4. Click Deploy

Useful:
  kubectl -n $PLATFORM_NAMESPACE get pods
  kubectl -n $PLATFORM_NAMESPACE logs deploy/web -f
  kubectl -n $PLATFORM_NAMESPACE logs deploy/worker -f

EOF
}

# ---- commands --------------------------------------------------------------
cmd_install() {
  require_root "$@"
  detect_os
  mkdir -p "$DATA_DIR"
  check_requirements
  install_k3s
  detect_or_clone_source
  try_pull_published_images
  build_and_import_images
  compute_effective_host
  create_namespace
  install_cert_manager
  apply_cluster_issuers
  apply_platform_secrets
  apply_rbac
  apply_postgres
  apply_registry
  apply_migrations_job
  apply_web_and_worker
  print_summary
}

cmd_update() {
  require_root "$@"
  detect_os
  detect_or_clone_source
  try_pull_published_images
  build_and_import_images
  compute_effective_host
  apply_migrations_job
  apply_web_and_worker
  ok "Update complete"
}

cmd_uninstall() {
  require_root "$@"
  warn "This will remove Korepush platform components."
  if $PURGE; then
    err "PURGE MODE: this deletes the database, registry, and ALL project namespaces."
    if ! $ASSUME_YES; then
      read -r -p "Type PURGE to confirm: " confirm
      [[ "$confirm" == "PURGE" ]] || die "Aborted."
    fi
    kubectl get ns -l app.kubernetes.io/managed-by=korepush -o name 2>/dev/null | xargs -r kubectl delete --wait=false
    kubectl delete ns "$PLATFORM_NAMESPACE" --wait=true || true
  else
    kubectl -n "$PLATFORM_NAMESPACE" delete deploy web worker --ignore-not-found
    kubectl -n "$PLATFORM_NAMESPACE" delete ingress web --ignore-not-found
    warn "Postgres, registry, and project namespaces left in place. Re-run with --purge to remove them."
  fi
  ok "Uninstall complete"
}

main() {
  parse_args "$@"
  case "$COMMAND" in
    install)   cmd_install "$@" ;;
    update)    cmd_update "$@" ;;
    uninstall) cmd_uninstall "$@" ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
