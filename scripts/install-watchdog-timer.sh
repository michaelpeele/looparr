#!/usr/bin/env bash
set -Eeuo pipefail

# Install the Looparr watchdog as a systemd user timer.
#
# Rewrites the __LOOPARR_REPO__ placeholder in the unit files to this repo's
# absolute path, installs copies under ~/.config/systemd/user/, reloads the
# user manager, enables the timer now, and enables linger so the timer survives
# logout/reboot. Idempotent: re-running refreshes the installed units.
#
# Usage:
#   scripts/install-watchdog-timer.sh              install/refresh + enable
#   scripts/install-watchdog-timer.sh --uninstall  disable + remove units

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/systemd"
DST_DIR="${HOME}/.config/systemd/user"
TIMER_NAME="looparr-watchdog.timer"
SERVICE_NAME="looparr-watchdog.service"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

render_unit() {
  local src="$1" dst="$2"
  # Replace the repo placeholder with the absolute repo path. '|' delimiter is
  # safe because repo paths do not contain '|'.
  sed "s|__LOOPARR_REPO__|${ROOT}|g" "$src" >"$dst"
}

install_units() {
  require_cmd systemctl
  require_cmd sed

  if [[ ! -f "$SRC_DIR/$TIMER_NAME" || ! -f "$SRC_DIR/$SERVICE_NAME" ]]; then
    printf 'Missing unit source files under %s\n' "$SRC_DIR" >&2
    exit 1
  fi

  mkdir -p "$DST_DIR"
  render_unit "$SRC_DIR/$SERVICE_NAME" "$DST_DIR/$SERVICE_NAME"
  render_unit "$SRC_DIR/$TIMER_NAME" "$DST_DIR/$TIMER_NAME"

  systemctl --user daemon-reload
  systemctl --user enable --now "$TIMER_NAME"

  if command -v loginctl >/dev/null 2>&1; then
    if loginctl enable-linger "$USER" >/dev/null 2>&1; then
      printf 'Enabled linger for %s (timer survives logout/reboot).\n' "$USER"
    else
      printf 'Note: could not enable linger automatically. Run once with sudo:\n'
      printf '  sudo loginctl enable-linger %s\n' "$USER"
    fi
  else
    printf 'Note: loginctl not found; enable linger manually if the timer must survive logout.\n'
  fi

  printf 'Looparr watchdog timer installed and enabled (%s).\n' "$TIMER_NAME"
}

uninstall_units() {
  require_cmd systemctl
  systemctl --user disable --now "$TIMER_NAME" >/dev/null 2>&1 || true
  rm -f "$DST_DIR/$TIMER_NAME" "$DST_DIR/$SERVICE_NAME"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
  printf 'Looparr watchdog timer removed.\n'
}

case "${1:-}" in
  ""|--install) install_units ;;
  --uninstall) uninstall_units ;;
  -h|--help)
    printf 'Usage: scripts/install-watchdog-timer.sh [--install|--uninstall]\n'
    ;;
  *)
    printf 'Unknown argument: %s\n\n' "$1" >&2
    printf 'Usage: scripts/install-watchdog-timer.sh [--install|--uninstall]\n' >&2
    exit 2
    ;;
esac