#!/usr/bin/env bash
set -Eeuo pipefail

# Watchdog for interrupted Looparr restarts.
#
# Failure it guards against (observed 2026-11-23 15:48 UTC): a `docker compose
# up -d looparr` was killed between creating the replacement container
# (label com.docker.compose.replace=looparr) and starting it. The old container
# exited 0, the replacement sat in status "created" forever, and the UI went
# offline because nothing listened on the compose port. `restart:
# unless-stopped` does not resurrect a container that was never started.
#
# Modes:
#   fix    (default) If no looparr container is running and a stopped/created
#          looparr compose container exists, re-converge the service with
#          `docker compose up -d looparr` under the restart lock, then verify
#          the API answers. Exit 0 on success.
#   check  Startless check only: exit 0 when a looparr container is running,
#          exit 1 when the service is down (regardless of orphans). Never
#          changes anything and never takes the restart lock.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="fix"
case "${1:-}" in
  fix|check) MODE="$1" ;;
  -h|--help) printf 'Usage: scripts/restart-watchdog.sh [fix|check]\n'; exit 0 ;;
  *) printf 'Usage: scripts/restart-watchdog.sh [fix|check]\n' >&2; exit 2 ;;
esac

LOG_FILE="${LOOPARR_WATCHDOG_LOG:-$ROOT/logs/watchdog.log}"
LOCAL_PORT="${LOOPARR_LOCAL_PORT:-4188}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '[%s] [looparr-watchdog] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

# fix mode must not race an ongoing promotion or restart; rejections bubble out
# of restart-lock.sh (exit 75) with their own log entry. check mode never
# mutates, so it skips the lock entirely.
if [[ "$MODE" == "fix" && "${LOOPARR_RESTART_LOCK_HELD:-0}" != 1 ]]; then
  exec bash "$ROOT/scripts/restart-lock.sh" bash "$ROOT/scripts/restart-watchdog.sh" "$@"
fi

running_id="$(docker ps -q --filter label=com.docker.compose.service=looparr | head -n1)"

if [[ -n "$running_id" ]]; then
  log "steady: looparr container ${running_id} is running"
  exit 0
fi

orphan_ids="$(docker ps -a -q --filter label=com.docker.compose.service=looparr | head -n5)"
orphan_count="$(printf '%s' "$orphan_ids" | grep -c . || true)"

if [[ "$MODE" == "check" ]]; then
  log "check: looparr service is DOWN (orphan/non-running compose containers: ${orphan_count})"
  exit 1
fi

if [[ "$orphan_count" == "0" ]]; then
  log "fix: looparr service is down with no existing compose container; starting a new one"
else
  log "fix: detected ${orphan_count} non-running looparr compose container(s); re-converging via compose up -d"
fi

if ! docker compose up -d looparr; then
  log "FAILED: docker compose up -d looparr returned an error (exit $?)"
  exit 1
fi

for _ in $(seq 1 60); do
  if curl -fsS -m 3 "http://127.0.0.1:${LOCAL_PORT}/api/state" >/dev/null 2>&1; then
    log "fix: looparr API is answering on port ${LOCAL_PORT}; recovery complete"
    exit 0
  fi
  sleep 2
done

log "FAILED: looparr container started but the API on port ${LOCAL_PORT} never answered"
exit 1
