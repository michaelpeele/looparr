#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ${LOOPARR_RESTART_LOCK_HELD:-0} != 1 ]]; then
  exec bash "$ROOT/scripts/restart-lock.sh" bash "$ROOT/scripts/promote.sh" "$@"
fi

LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/promotions.log"
MODE="full"
SANDBOX_PORT="${LOOPARR_PROMOTE_SANDBOX_PORT:-4199}"
SANDBOX_CONTAINER=""
WORK_DIR=""

mkdir -p "$LOG_DIR"

log() {
  printf '[%s] [looparr-promote] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

usage() {
  cat <<'EOF'
Usage: scripts/promote.sh [mode]

Modes:
  full            Build, sandbox smoke test, then restart production (default)
  --sandbox-only  Build and run sandbox smoke test only
  --prod-only     Restart production only via npm run restart:looparr
  -h, --help      Show this help

Environment:
  LOOPARR_PROMOTE_SANDBOX_PORT  Sandbox port (default: 4199)
EOF
}

cleanup() {
  if [[ -n "$SANDBOX_CONTAINER" ]]; then
    docker rm -f "$SANDBOX_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
}

on_error() {
  local status=$?
  local line=$1
  log "FAILED: exit ${status} at line ${line}"
  exit "$status"
}

trap 'on_error "$LINENO"' ERR
trap cleanup EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "Missing required command: $1"
    exit 1
  }
}

build_image() {
  log "Building looparr:latest"
  docker compose build looparr
}

write_sandbox_config() {
  local base_config="$ROOT/data/config.json"
  local sandbox_config="$WORK_DIR/data/config.json"

  [[ -f "$base_config" ]] || {
    log "Missing base config: $base_config"
    exit 1
  }

  node - "$base_config" "$sandbox_config" <<'NODE'
const fs = require('fs');
const [source, target] = process.argv.slice(2);
const base = JSON.parse(fs.readFileSync(source, 'utf8'));
base.settings = {
  ...(base.settings || {}),
  maxConcurrent: 1,
  mode: 'roundrobin'
};
base.projects = [
  {
    id: 'promote-sandbox',
    name: 'Promote sandbox',
    path: '/looparr-promote-sandbox',
    runner: 'opencode',
    autoResumeOnStart: false
  }
];
fs.writeFileSync(target, `${JSON.stringify(base, null, 2)}\n`);
NODE
}

wait_for_sandbox() {
  local state=""
  local attempt

  for attempt in $(seq 1 60); do
    if state="$(curl -fsS "http://127.0.0.1:${SANDBOX_PORT}/api/state" 2>/dev/null)"; then
      if printf '%s' "$state" | node -e '
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  const state = JSON.parse(body);
  const project = (state.projects || []).find((item) => item.name === "Promote sandbox");
  if (!project || project.nextTask !== "sandbox smoke task") process.exit(1);
});
'; then
        log "Sandbox state verified on port ${SANDBOX_PORT}"
        return 0
      fi
    fi
    sleep 2
  done

  log "Sandbox did not become ready on port ${SANDBOX_PORT}"
  docker logs "$SANDBOX_CONTAINER" 2>&1 | tail -80 >>"$LOG_FILE" || true
  return 1
}

sandbox_smoke() {
  build_image

  local tmp_root="${TMPDIR:-/tmp/opencode}"
  mkdir -p "$tmp_root"
  WORK_DIR="$(mktemp -d "$tmp_root/looparr-promote.XXXXXX")"
  mkdir -p "$WORK_DIR/data" "$WORK_DIR/project"
  printf '# Plan\n\n- [ ] sandbox smoke task\n' >"$WORK_DIR/project/plan.md"
  write_sandbox_config

  SANDBOX_CONTAINER="looparr-promote-sandbox-$$"
  log "Starting sandbox container ${SANDBOX_CONTAINER} on port ${SANDBOX_PORT}"

  docker run -d \
    --name "$SANDBOX_CONTAINER" \
    --rm \
    -p "${SANDBOX_PORT}:3000" \
    -e HOST=0.0.0.0 \
    -e PORT=3000 \
    -e CONFIG_PATH=/app/data/config.json \
    -e HOSTNAME=looparr-promote-sandbox \
    -v "$WORK_DIR/data:/app/data" \
    -v "$WORK_DIR/project:/looparr-promote-sandbox" \
    looparr:latest >/dev/null

  wait_for_sandbox
  log "Sandbox smoke passed"
}

promote_prod() {
  log "Restarting production via npm run restart:looparr"
  npm run restart:looparr
  log "Production restart passed"
}

case "${1:-}" in
  ""|full) MODE="full" ;;
  --sandbox-only) MODE="sandbox" ;;
  --prod-only) MODE="prod" ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    printf 'Unknown mode: %s\n\n' "$1" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ $# -gt 1 ]]; then
  printf 'Too many arguments\n\n' >&2
  usage >&2
  exit 2
fi

require_cmd docker
require_cmd npm
require_cmd node
require_cmd curl

log "Starting promotion (${MODE})"

case "$MODE" in
  full)
    sandbox_smoke
    promote_prod
    ;;
  sandbox)
    sandbox_smoke
    ;;
  prod)
    promote_prod
    ;;
esac

log "OK (${MODE})"
