#!/usr/bin/env bash
#
# Smoke-test the install script on a clean Ubuntu 24.04 microVM.
#
# Spawns a fresh VM (OrbStack by default, multipass as fallback), runs the
# install one-liner inside it, polls the dashboard until it answers, then
# destroys the VM. Use --keep to poke around afterwards.
#
# Usage:
#   ./dev/test-installer.sh                      # spin up, install, verify, destroy
#   ./dev/test-installer.sh --keep               # keep the VM after the test
#   ./dev/test-installer.sh --ref my-branch      # install from a different git ref
#   ./dev/test-installer.sh --arch arm64         # arm64 VM (falls back to source build)
#   ./dev/test-installer.sh --runtime multipass  # force multipass over orb
#
set -euo pipefail

VM_NAME="${VM_NAME:-korepush-test}"
KORE_REPO_USER="arthurliebhardt"
KORE_REPO_NAME="korepush2"
KORE_REF="${KORE_REF:-main}"
ARCH="${ARCH:-amd64}"           # matches our prebuilt linux/amd64 images
KEEP=false
RUNTIME=""
WAIT_SECONDS="${WAIT_SECONDS:-600}"   # 10 min: covers build-from-source fallback

GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YEL=$'\033[0;33m'; BLU=$'\033[0;34m'; OFF=$'\033[0m'
log()  { printf "%s==>%s %s\n" "$BLU" "$OFF" "$*"; }
ok()   { printf "%s ✓%s %s\n" "$GREEN" "$OFF" "$*"; }
warn() { printf "%s ⚠%s %s\n" "$YEL" "$OFF" "$*"; }
die()  { printf "%s ✗%s %s\n" "$RED" "$OFF" "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Spins up a fresh Ubuntu 24.04 VM, runs the install one-liner in it, and
verifies the dashboard responds on :8000. Destroys the VM after unless --keep.

Options:
  --keep              Keep the VM after the test
  --name NAME         VM name (default: $VM_NAME)
  --ref REF           Git ref to install from (default: $KORE_REF)
  --arch amd64|arm64  VM arch (default: amd64 — matches prebuilt images.
                      arm64 falls back to source build inside the VM)
  --runtime orb|multipass    Override autodetection
  --wait SECONDS      Dashboard-poll timeout (default: $WAIT_SECONDS)
  -h, --help          Show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keep)    KEEP=true; shift ;;
      --name)    VM_NAME="$2"; shift 2 ;;
      --ref)     KORE_REF="$2"; shift 2 ;;
      --arch)    ARCH="$2"; shift 2 ;;
      --runtime) RUNTIME="$2"; shift 2 ;;
      --wait)    WAIT_SECONDS="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown arg: $1 (try --help)" ;;
    esac
  done
}

installer_url() {
  echo "https://raw.githubusercontent.com/${KORE_REPO_USER}/${KORE_REPO_NAME}/${KORE_REF}/installer/install.sh"
}

# ---- runtime ---------------------------------------------------------------
detect_runtime() {
  if [[ -n "$RUNTIME" ]]; then
    command -v "$RUNTIME" >/dev/null || die "$RUNTIME not on PATH"
    return
  fi
  if command -v orb >/dev/null; then
    RUNTIME=orb
  elif command -v multipass >/dev/null; then
    RUNTIME=multipass
  else
    die "Need OrbStack (https://orbstack.dev) or multipass (brew install multipass)"
  fi
  ok "Using runtime: $RUNTIME"
}

vm_exists() {
  case "$RUNTIME" in
    orb)       orb list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$VM_NAME" ;;
    multipass) multipass info "$VM_NAME" >/dev/null 2>&1 ;;
  esac
}

destroy_vm() {
  case "$RUNTIME" in
    orb)       orb delete "$VM_NAME" 2>/dev/null || true ;;
    multipass) multipass delete -p "$VM_NAME" 2>/dev/null || true ;;
  esac
}

create_vm() {
  if vm_exists; then
    warn "VM '$VM_NAME' already exists — destroying first"
    destroy_vm
  fi
  log "Creating $RUNTIME VM '$VM_NAME' (ubuntu:24.04, $ARCH)"
  case "$RUNTIME" in
    orb)
      orb create --arch "$ARCH" ubuntu:24.04 "$VM_NAME"
      ;;
    multipass)
      # multipass uses --memory/--disk/--cpus to satisfy our requirements check
      multipass launch 24.04 --name "$VM_NAME" --memory 4G --disk 20G --cpus 2
      ;;
  esac
  ok "VM created"
}

vm_ip() {
  case "$RUNTIME" in
    orb)       orb -m "$VM_NAME" -u root -- hostname -I 2>/dev/null | awk '{print $1}' ;;
    multipass) multipass exec "$VM_NAME" -- hostname -I 2>/dev/null | awk '{print $1}' ;;
  esac
}

wait_for_vm_ip() {
  log "Waiting for VM networking"
  local ip="" tries=0
  while [[ -z "$ip" && $tries -lt 30 ]]; do
    ip="$(vm_ip || true)"
    [[ -n "$ip" ]] && break
    sleep 1
    tries=$((tries+1))
  done
  [[ -n "$ip" ]] || die "VM didn't get an IP after 30s"
  echo "$ip"
}

run_in_vm() {
  case "$RUNTIME" in
    orb)       orb -m "$VM_NAME" -u root -- bash -c "$1" ;;
    multipass) multipass exec "$VM_NAME" -- sudo bash -c "$1" ;;
  esac
}

# ---- test flow -------------------------------------------------------------
run_installer() {
  local url; url="$(installer_url)"
  log "Running installer from $url"
  echo "------------------------------------------------------------------"
  run_in_vm "curl -fsSL '$url' | bash"
  echo "------------------------------------------------------------------"
  ok "Installer exited 0"
}

poll_dashboard() {
  local ip="$1"
  local url="http://${ip}:8000/setup"
  local deadline=$(($(date +%s) + WAIT_SECONDS))
  log "Polling $url (up to ${WAIT_SECONDS}s)"
  while [[ $(date +%s) -lt $deadline ]]; do
    local code
    code="$(curl -fsSL -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || echo "000")"
    case "$code" in
      200|302|303|307|308)
        echo
        ok "Dashboard responding (HTTP $code) at http://${ip}:8000"
        return 0
        ;;
    esac
    printf "."
    sleep 5
  done
  echo
  die "Dashboard never answered at $url within ${WAIT_SECONDS}s"
}

dump_diagnostics() {
  local ip="${1:-}"
  warn "Test failed — dumping diagnostics so you can debug"
  run_in_vm 'kubectl -n korepush-system get pods,svc,ingress 2>&1 || true' || true
  run_in_vm 'kubectl -n korepush-system logs deploy/web --tail=40 2>&1 || true' || true
  run_in_vm 'kubectl -n korepush-system logs deploy/worker --tail=40 2>&1 || true' || true
  if [[ -n "$ip" ]]; then
    warn "Last failed URL: http://${ip}:8000/setup"
  fi
}

on_exit() {
  local exit_code=$?
  if [[ $exit_code -ne 0 ]] && vm_exists; then
    dump_diagnostics "${VM_IP:-}" || true
  fi
  if $KEEP; then
    cat <<EOF

${GREEN}VM left running for inspection.${OFF}

  Shell into it:   $( [[ "$RUNTIME" == "orb" ]] && echo "orb -m $VM_NAME" || echo "multipass shell $VM_NAME" )
  Dashboard:       ${VM_IP:+http://$VM_IP:8000}
  Destroy when done: $( [[ "$RUNTIME" == "orb" ]] && echo "orb delete $VM_NAME" || echo "multipass delete -p $VM_NAME" )

EOF
    exit $exit_code
  fi
  if vm_exists; then
    log "Destroying VM '$VM_NAME'"
    destroy_vm
    ok "Cleanup done"
  fi
  exit $exit_code
}

main() {
  parse_args "$@"
  detect_runtime
  create_vm
  VM_IP="$(wait_for_vm_ip)"
  ok "VM IP: $VM_IP"
  trap on_exit EXIT

  run_installer
  poll_dashboard "$VM_IP"

  cat <<EOF

${GREEN}╭───────────────────────────────────────────╮${OFF}
${GREEN}│ Installer smoke test PASSED               │${OFF}
${GREEN}╰───────────────────────────────────────────╯${OFF}

Dashboard: http://${VM_IP}:8000
EOF
}

main "$@"
