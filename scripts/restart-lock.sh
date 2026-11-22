#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_PATH="${LOOPARR_RESTART_LOCK_PATH:-${TMPDIR:-/tmp/opencode}/looparr-restart.lock}"
LOCK_DIR="${LOCK_PATH}.dir"
PROMOTIONS_LOG="${LOOPARR_PROMOTIONS_LOG:-$ROOT/logs/promotions.log}"
LOCK_MODE=""
CHILD_PID=""

if [[ $# -lt 1 ]]; then
  printf 'Usage: scripts/restart-lock.sh <command> [args...]\n' >&2
  exit 2
fi

mkdir -p "$(dirname "$LOCK_PATH")" "$(dirname "$PROMOTIONS_LOG")"

reject_locked() {
  local message="lock-rejected: another promotion or restart is running (lock: ${LOCK_PATH})"
  local structured='{"event":"error","code":"PROMOTION_LOCK_HELD","message":"another promotion or restart is running"}'
  printf '[looparr-promote] %s\n' "$message" >&2
  printf '%s\n' "$structured" >&2
  printf '[%s] [looparr-promote] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$message" >>"$PROMOTIONS_LOG"
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$structured" >>"$PROMOTIONS_LOG"
  exit 75
}

release_lock() {
  trap - EXIT INT TERM
  if [[ "$LOCK_MODE" == "flock" ]]; then
    flock -u 9 2>/dev/null || true
    exec 9>&-
  elif [[ "$LOCK_MODE" == "dir" ]]; then
    rm -rf "$LOCK_DIR"
  fi
  LOCK_MODE=""
}

on_exit() {
  local status=$?
  release_lock
  exit "$status"
}

on_signal() {
  local signal="$1"
  local status="$2"
  if [[ -n "$CHILD_PID" ]] && kill -0 "$CHILD_PID" 2>/dev/null; then
    kill -"$signal" "$CHILD_PID" 2>/dev/null || true
  fi
  exit "$status"
}

trap on_exit EXIT
trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM

if command -v flock >/dev/null 2>&1; then
  : >>"$LOCK_PATH"
  exec 9>>"$LOCK_PATH"
  if ! flock -n 9; then
    reject_locked
  fi
  LOCK_MODE="flock"
else
  for _ in 1 2; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf '%s\n' "$$" >"$LOCK_DIR/pid"
      LOCK_MODE="dir"
      break
    fi

    pid=""
    if [[ -f "$LOCK_DIR/pid" ]]; then
      read -r pid <"$LOCK_DIR/pid" 2>/dev/null || pid=""
    fi
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      reject_locked
    fi
    rm -rf "$LOCK_DIR"
  done

  if [[ "$LOCK_MODE" != "dir" ]]; then
    reject_locked
  fi
fi

export LOOPARR_RESTART_LOCK_HELD=1
"$@" &
CHILD_PID=$!

set +e
wait "$CHILD_PID"
status=$?
set -e
CHILD_PID=""
exit "$status"
