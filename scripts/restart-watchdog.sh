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
#   timer  systemd-timer cycle: run the fix body under the restart lock, keep a
#          cycle counter, treat a held lock (exit 75) as a quiet `busy:` skip,
#          and every 5th cycle run the read-only check body as a `review:` pass.
#          Never bypasses scripts/restart-lock.sh and never reports a held lock
#          as a failure.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="fix"
case "${1:-}" in
  fix|check|timer) MODE="$1" ;;
  -h|--help) printf 'Usage: scripts/restart-watchdog.sh [fix|check|timer]\n'; exit 0 ;;
  *) printf 'Usage: scripts/restart-watchdog.sh [fix|check|timer]\n' >&2; exit 2 ;;
esac

LOG_FILE="${LOOPARR_WATCHDOG_LOG:-$ROOT/logs/watchdog.log}"
CYCLE_FILE="${LOOPARR_WATCHDOG_CYCLE_FILE:-$ROOT/logs/watchdog-cycle-count}"
LOCAL_PORT="${LOOPARR_LOCAL_PORT:-4188}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '[%s] [looparr-watchdog] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

# timer mode owns cycle counting, exit-75 normalization, and the every-5th
# review. It delegates the mutate pass to `restart-watchdog.sh fix` under the
# restart lock (never bypassing restart-lock.sh) and the review pass to the
# read-only `restart-watchdog.sh check` body.
run_timer_mode() {
  local count=0
  if [[ -f "$CYCLE_FILE" ]]; then
    read -r count <"$CYCLE_FILE" 2>/dev/null || count=0
  fi
  if ! [[ "$count" =~ ^[0-9]+$ ]]; then
    count=0
  fi
  count=$((count + 1))
  printf '%s\n' "$count" >"$CYCLE_FILE"

  local fix_status=0
  set +e
  bash "$ROOT/scripts/restart-lock.sh" bash "$ROOT/scripts/restart-watchdog.sh" fix
  fix_status=$?
  set -e

  if [[ "$fix_status" -eq 75 ]]; then
    log "busy: restarting/promotion lock held; skipping this cycle"
    exit 0
  fi
  if [[ "$fix_status" -ne 0 ]]; then
    exit 1
  fi

  if (( count % 5 == 0 )); then
    local check_status=0
    set +e
    bash "$ROOT/scripts/restart-watchdog.sh" check
    check_status=$?
    set -e
    if [[ "$check_status" -eq 0 ]]; then
      log "review: looparr service is up (cycle ${count})"
    else
      log "FAILED: review check reports the service down (cycle ${count})"
      exit 1
    fi
  fi

  exit 0
}

if [[ "$MODE" == "timer" ]]; then
  run_timer_mode
fi

# fix mode must not race an ongoing promotion or restart; rejections bubble out
# of restart-lock.sh (exit 75) with their own log entry. check mode never
# mutates, so it skips the lock entirely.
if [[ "$MODE" == "fix" && "${LOOPARR_RESTART_LOCK_HELD:-0}" != 1 ]]; then
  exec bash "$ROOT/scripts/restart-lock.sh" bash "$ROOT/scripts/restart-watchdog.sh" "$@"
fi

running_id="$(docker ps -q --filter label=com.docker.compose.service=looparr | head -n1)"

# check mode is strictly read-only: a running container is steady, otherwise the
# service is down. It never probes /api/state and never mutates.
if [[ "$MODE" == "check" ]]; then
  if [[ -n "$running_id" ]]; then
    log "steady: looparr container ${running_id} is running"
    exit 0
  fi
  orphan_ids="$(docker ps -a -q --filter label=com.docker.compose.service=looparr | head -n5)"
  orphan_count="$(printf '%s' "$orphan_ids" | grep -c . || true)"
  log "check: looparr service is DOWN (orphan/non-running compose containers: ${orphan_count})"
  exit 1
fi

# converge_and_wait re-converges the service with `docker compose up -d looparr`
# and polls /api/state. Used by fix mode both when no container runs and when a
# container runs but the API is not answering (an API-only outage).
converge_and_wait() {
  local reason="$1"
  log "fix: ${reason}; re-converging via compose up -d"
  if ! docker compose up -d looparr; then
    log "FAILED: docker compose up -d looparr returned an error (exit $?)"
    exit 1
  fi
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS -m 3 "http://127.0.0.1:${LOCAL_PORT}/api/state" >/dev/null 2>&1; then
      log "fix: looparr API is answering on port ${LOCAL_PORT}; recovery complete"
      exit 0
    fi
    sleep 2
  done
  log "FAILED: looparr container started but the API on port ${LOCAL_PORT} never answered"
  exit 1
}

if [[ -n "$running_id" ]]; then
  # A running compose container does not prove the API answers. Probe /api/state
  # first; only re-converge when it fails, so an API-only outage is repaired.
  if curl -fsS -m 3 "http://127.0.0.1:${LOCAL_PORT}/api/state" >/dev/null 2>&1; then
    log "steady: looparr container ${running_id} is running and API answers on port ${LOCAL_PORT}"
    exit 0
  fi
  converge_and_wait "container ${running_id} is running but API on port ${LOCAL_PORT} is not answering"
fi

orphan_ids="$(docker ps -a -q --filter label=com.docker.compose.service=looparr | head -n5)"
orphan_count="$(printf '%s' "$orphan_ids" | grep -c . || true)"

if [[ "$orphan_count" == "0" ]]; then
  converge_and_wait "looparr service is down with no existing compose container; starting a new one"
else
  converge_and_wait "detected ${orphan_count} non-running looparr compose container(s)"
fi