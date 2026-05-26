#!/usr/bin/env bash
#
# Spin up korepush on a local Docker-based Kubernetes (k3d or OrbStack).
# Mirrors what installer/install.sh does on a VPS, but for a Mac/Linux laptop.
#
# Usage:
#   ./dev/up.sh                  # build + apply everything, open http://localhost:8000
#   PORT=9000 ./dev/up.sh        # use a different host port
#   SKIP_BUILD=1 ./dev/up.sh     # re-apply manifests without rebuilding images
#   ./dev/up.sh logs             # tail web + worker logs
#   ./dev/up.sh down             # delete everything (keeps cluster)
#   ./dev/up.sh nuke             # delete the cluster too
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NS="${PLATFORM_NAMESPACE:-korepush-system}"
PORT="${PORT:-8000}"
CLUSTER_NAME="${CLUSTER_NAME:-korepush}"
WEB_IMAGE="korepush-web:dev"
WORKER_IMAGE="korepush-worker:dev"
RUNTIME=""  # set by detect_runtime: k3d | orbstack

GREEN=$'\033[0;32m'; YEL=$'\033[0;33m'; BLU=$'\033[0;34m'; RED=$'\033[0;31m'; OFF=$'\033[0m'
log()  { printf "%s==>%s %s\n" "$BLU" "$OFF" "$*"; }
ok()   { printf "%s ✓%s %s\n" "$GREEN" "$OFF" "$*"; }
warn() { printf "%s ⚠%s %s\n" "$YEL" "$OFF" "$*"; }
die()  { printf "%s ✗%s %s\n" "$RED" "$OFF" "$*" >&2; exit 1; }

require_bin() { command -v "$1" >/dev/null || die "Missing $1 — install it first"; }

# ---- runtime detection / bootstrap ----------------------------------------
detect_runtime() {
  require_bin docker
  require_bin kubectl

  # Prefer OrbStack if it's the active context.
  if kubectl config get-contexts -o name 2>/dev/null | grep -qx "orbstack"; then
    if kubectl --context orbstack get nodes >/dev/null 2>&1; then
      kubectl config use-context orbstack >/dev/null
      RUNTIME=orbstack
      ok "Using OrbStack Kubernetes"
      return
    fi
  fi

  # Otherwise, k3d.
  if ! command -v k3d >/dev/null; then
    die "Need k3d or OrbStack K8s. Install k3d: brew install k3d
Or enable OrbStack: open OrbStack → Settings → Kubernetes → ON, then re-run."
  fi
  ensure_k3d_cluster
  kubectl config use-context "k3d-$CLUSTER_NAME" >/dev/null
  RUNTIME=k3d
  ok "Using k3d cluster: $CLUSTER_NAME"
}

ensure_k3d_cluster() {
  if k3d cluster list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$CLUSTER_NAME"; then
    return
  fi
  log "Creating k3d cluster '$CLUSTER_NAME' (host :$PORT → traefik :80)"
  k3d cluster create "$CLUSTER_NAME" \
    --port "${PORT}:80@loadbalancer" \
    --agents 0 \
    --wait
}

# ---- image build + import --------------------------------------------------
build_images() {
  if [[ -n "${SKIP_BUILD:-}" ]]; then
    ok "Skipping build (SKIP_BUILD set)"
    return
  fi
  log "Building $WEB_IMAGE"
  ( cd "$REPO_ROOT" && docker build -t "$WEB_IMAGE" -f apps/web/Dockerfile . ) \
    >/dev/null
  log "Building $WORKER_IMAGE"
  ( cd "$REPO_ROOT" && docker build -t "$WORKER_IMAGE" -f apps/worker/Dockerfile . ) \
    >/dev/null
  ok "Images built"
}

import_images() {
  case "$RUNTIME" in
    k3d)
      log "Importing images into k3d"
      k3d image import -c "$CLUSTER_NAME" "$WEB_IMAGE" "$WORKER_IMAGE" >/dev/null
      ;;
    orbstack)
      # OrbStack shares the host Docker daemon — no import step required.
      ;;
  esac
}

# ---- k8s resources ---------------------------------------------------------
apply_namespace() {
  kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create ns "$NS"
}

apply_secrets() {
  # These values are dev-only stand-ins. Don't reuse them in production.
  kubectl -n "$NS" get secret korepush-db >/dev/null 2>&1 || \
    kubectl -n "$NS" create secret generic korepush-db \
      --from-literal=POSTGRES_USER=korepush \
      --from-literal=POSTGRES_PASSWORD=dev-only-password \
      --from-literal=POSTGRES_DB=korepush

  local web_url="http://localhost:${PORT}"
  local db_url="postgres://korepush:dev-only-password@postgres.${NS}.svc.cluster.local:5432/korepush"

  kubectl -n "$NS" get secret korepush-app >/dev/null 2>&1 || \
    kubectl -n "$NS" create secret generic korepush-app \
      --from-literal=DATABASE_URL="$db_url" \
      --from-literal=BETTER_AUTH_SECRET="dev-better-auth-secret-pad-to-32-chars-easy" \
      --from-literal=BETTER_AUTH_URL="$web_url" \
      --from-literal=ENCRYPTION_KEY="dev-encryption-key-pad-to-32-chars-please-ok" \
      --from-literal=REGISTRY_URL="registry.${NS}.svc.cluster.local:5000" \
      --from-literal=PLATFORM_NAMESPACE="$NS"

  # Reconcile BETTER_AUTH_URL in case PORT changed.
  kubectl -n "$NS" patch secret korepush-app --type merge \
    -p "{\"stringData\":{\"BETTER_AUTH_URL\":\"$web_url\"}}" >/dev/null
}

apply_rbac() {
  kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ServiceAccount
metadata: { name: korepush-worker, namespace: $NS }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: korepush-worker }
rules:
  - apiGroups: [""]
    resources: ["namespaces","secrets","services","configmaps","serviceaccounts","pods","pods/log","events"]
    verbs: ["get","list","watch","create","update","patch","delete"]
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
subjects: [{ kind: ServiceAccount, name: korepush-worker, namespace: $NS }]
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: korepush-worker }
EOF
}

apply_postgres_and_registry() {
  kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: korepush-postgres, namespace: $NS }
spec:
  accessModes: ["ReadWriteOnce"]
  resources: { requests: { storage: 2Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: postgres, namespace: $NS }
spec:
  selector: { app.kubernetes.io/name: postgres }
  ports: [{ name: pg, port: 5432, targetPort: 5432 }]
  clusterIP: None
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: postgres, namespace: $NS }
spec:
  serviceName: postgres
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: postgres } }
  template:
    metadata: { labels: { app.kubernetes.io/name: postgres } }
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports: [{ containerPort: 5432 }]
          envFrom: [{ secretRef: { name: korepush-db } }]
          env: [{ name: PGDATA, value: /var/lib/postgresql/data/pgdata }]
          volumeMounts: [{ name: data, mountPath: /var/lib/postgresql/data }]
          readinessProbe:
            exec: { command: ["pg_isready","-U","korepush","-d","korepush"] }
            initialDelaySeconds: 3
            periodSeconds: 3
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: korepush-postgres }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: korepush-registry, namespace: $NS }
spec:
  accessModes: ["ReadWriteOnce"]
  resources: { requests: { storage: 5Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: registry, namespace: $NS }
spec:
  selector: { app.kubernetes.io/name: registry }
  ports: [{ name: registry, port: 5000, targetPort: 5000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: registry, namespace: $NS }
spec:
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: registry } }
  template:
    metadata: { labels: { app.kubernetes.io/name: registry } }
    spec:
      containers:
        - name: registry
          image: registry:2.8.3
          ports: [{ containerPort: 5000 }]
          volumeMounts: [{ name: data, mountPath: /var/lib/registry }]
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: korepush-registry }
EOF
  log "Waiting for Postgres"
  kubectl -n "$NS" rollout status statefulset/postgres --timeout=180s
}

run_migrations() {
  log "Running database migrations"
  local job="korepush-migrate-$(date +%s)"
  kubectl apply -f - >/dev/null <<EOF
apiVersion: batch/v1
kind: Job
metadata: { name: $job, namespace: $NS }
spec:
  backoffLimit: 2
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrate
          image: $WORKER_IMAGE
          imagePullPolicy: Never
          command: ["./node_modules/.bin/tsx","./node_modules/@korepush/db/src/migrate.ts"]
          envFrom: [{ secretRef: { name: korepush-app } }]
EOF
  kubectl -n "$NS" wait --for=condition=complete --timeout=180s "job/$job"
}

apply_web_and_worker() {
  log "Applying web + worker"
  kubectl apply -f - >/dev/null <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: web, namespace: $NS }
spec:
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: web } }
  template:
    metadata: { labels: { app.kubernetes.io/name: web } }
    spec:
      containers:
        - name: web
          image: $WEB_IMAGE
          imagePullPolicy: Never
          ports: [{ containerPort: 3000 }]
          envFrom: [{ secretRef: { name: korepush-app } }]
          readinessProbe:
            httpGet: { path: /, port: 3000 }
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: worker, namespace: $NS }
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
          imagePullPolicy: Never
          envFrom: [{ secretRef: { name: korepush-app } }]
EOF

  # Service strategy depends on runtime: k3d routes :PORT → :80 via its load
  # balancer (because we set --port 8000:80@loadbalancer at cluster create),
  # so the web service goes through an Ingress on port 80. OrbStack exposes
  # any LoadBalancer service on the host directly, so we use type=LoadBalancer.
  if [[ "$RUNTIME" == "orbstack" ]]; then
    kubectl -n "$NS" delete ingress web --ignore-not-found >/dev/null
    kubectl -n "$NS" delete service web --ignore-not-found >/dev/null
    kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Service
metadata: { name: web, namespace: $NS }
spec:
  type: LoadBalancer
  selector: { app.kubernetes.io/name: web }
  ports:
    - name: http
      port: $PORT
      targetPort: 3000
EOF
  else
    kubectl -n "$NS" delete service web --ignore-not-found >/dev/null
    kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Service
metadata: { name: web, namespace: $NS }
spec:
  type: ClusterIP
  selector: { app.kubernetes.io/name: web }
  ports: [{ name: http, port: 80, targetPort: 3000 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: $NS
spec:
  ingressClassName: traefik
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: web, port: { number: 80 } }
EOF
  fi

  kubectl -n "$NS" rollout restart deployment/web    >/dev/null 2>&1 || true
  kubectl -n "$NS" rollout restart deployment/worker >/dev/null 2>&1 || true
  kubectl -n "$NS" rollout status  deployment/web    --timeout=120s
  kubectl -n "$NS" rollout status  deployment/worker --timeout=120s
}

# ---- commands --------------------------------------------------------------
cmd_up() {
  detect_runtime
  build_images
  import_images
  apply_namespace
  apply_secrets
  apply_rbac
  apply_postgres_and_registry
  run_migrations
  apply_web_and_worker
  echo
  ok "Korepush is up:"
  printf "    %shttp://localhost:%s%s\n" "$GREEN" "$PORT" "$OFF"
  echo
  echo "Useful:"
  echo "  ./dev/up.sh logs    # tail web + worker logs"
  echo "  ./dev/up.sh down    # delete all korepush resources (keeps cluster)"
  echo "  ./dev/up.sh nuke    # also delete the k3d cluster"
  echo "  SKIP_BUILD=1 ./dev/up.sh    # re-apply without rebuilding images"
}

cmd_logs() {
  detect_runtime
  exec kubectl -n "$NS" logs -f -l 'app.kubernetes.io/name in (web,worker)' --prefix=true --max-log-requests=10 --tail=50
}

cmd_down() {
  detect_runtime
  log "Deleting namespace $NS"
  kubectl delete ns "$NS" --wait=true || true
  ok "Cleaned up. Cluster left running. Re-run ./dev/up.sh to start over."
}

cmd_nuke() {
  detect_runtime
  cmd_down
  if [[ "$RUNTIME" == "k3d" ]]; then
    log "Deleting k3d cluster $CLUSTER_NAME"
    k3d cluster delete "$CLUSTER_NAME"
  fi
  ok "All gone."
}

cmd="${1:-up}"
case "$cmd" in
  up)   cmd_up ;;
  logs) cmd_logs ;;
  down) cmd_down ;;
  nuke) cmd_nuke ;;
  *) die "Unknown command: $cmd. Use: up | logs | down | nuke" ;;
esac
