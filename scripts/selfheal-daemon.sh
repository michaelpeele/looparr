#!/usr/bin/env bash
set -Eeuo pipefail

# Managed host-side standby self-healer.
#
# Prod (docker-compose.yml) stays a view-only primary: it never sets
# LOOPARR_SELFHEAL=1 and never spawns git/docker. This script runs the same
# Looparr engine on the HOST with LOOPARR_SELFHEAL=1, a distinct hostname, port,
# config path and log path, so it can watch fresh foreign errored checkpoints,
# run exactly one healed round, and write .looparr/selfheal/status/<projectId>.json
# for prod to read. It never adopts or resumes the primary's tasks
# (LOOPARR_SELFHEAL_STANDBY=1 gates that in src/engine.js), and merging stays
# human-gated.
#
# Usage: scripts/selfheal-daemon.sh start|stop|restart|status|install
#
# Everything is overridable by the LOOPARR_SELFHEAL_* variables listed in
# SELFHEALING.md ("Standby daemon").

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROD_HOSTNAME="${LOOPARR_PROD_HOSTNAME:-looparr}"
PORT="${LOOPARR_SELFHEAL_PORT:-4400}"
BIND_HOST="${LOOPARR_SELFHEAL_BIND:-127.0.0.1}"
DAEMON_HOSTNAME="${LOOPARR_SELFHEAL_HOSTNAME:-looparr-heal-host}"
CONFIG="${LOOPARR_SELFHEAL_CONFIG:-$ROOT/data/selfheal/config.json}"
if [[ -n "${LOOPARR_SELFHEAL_ARMED_CONFIG:-}" ]]; then
  ARMED_CONFIG="$LOOPARR_SELFHEAL_ARMED_CONFIG"
else
  ARMED_CONFIG=""
  for candidate in "$ROOT/data/config.json" "$ROOT/config.json"; do
    if [[ -f "$candidate" ]]; then
      ARMED_CONFIG="$candidate"
      break
    fi
  done
fi
PID_FILE="${LOOPARR_SELFHEAL_PID:-$ROOT/.looparr/selfheal-daemon.pid}"
LOG_FILE="${LOOPARR_SELFHEAL_LOG:-$ROOT/logs/selfheal-daemon.log}"
ENTRY="${LOOPARR_SELFHEAL_ENTRY:-$ROOT/server.js}"
UNIT_DIR="${LOOPARR_SELFHEAL_UNIT_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user}"

usage() {
  cat <<'EOF'
Usage: scripts/selfheal-daemon.sh <command>

Commands:
  start     Sync the arming setting, then start the standby healer (idempotent)
  stop      Stop it via its PID file (idempotent)
  restart   stop, then start
  status    Print state, PID, port, hostname, paths, git/docker and arming state
  install   Write the systemd --user unit and print the enable command
EOF
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() {
  mkdir -p "$(dirname "$LOG_FILE")"
  printf '[%s] [selfheal-daemon] %s\n' "$(now)" "$*" | tee -a "$LOG_FILE" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

pid_from_file() {
  local pid=""
  if [[ -f "$PID_FILE" ]]; then
    pid="$(tr -dc '0-9' < "$PID_FILE" || true)"
  fi
  printf '%s' "$pid"
}

pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

config_flag() {
  local file="$1"
  node -e '
    const fs = require("fs");
    try {
      const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const on = raw && raw.settings && raw.settings.selfHealing === true;
      process.stdout.write(on ? "on" : "off");
    } catch {
      process.stdout.write("missing");
    }
  ' "$file" 2>/dev/null || printf 'missing'
}

api_alive() {
  node -e '
    fetch(`http://127.0.0.1:${process.argv[1]}/api/state`)
      .then((response) => process.exit(response.ok ? 0 : 1))
      .catch(() => process.exit(1));
  ' "$PORT" >/dev/null 2>&1
}

api_armed() {
  node -e '
    fetch(`http://127.0.0.1:${process.argv[1]}/api/state`)
      .then((response) => response.json())
      .then((state) => process.exit(state && state.selfHealingAvailable === true ? 0 : 1))
      .catch(() => process.exit(1));
  ' "$PORT" >/dev/null 2>&1
}

wait_ready() {
  local pid="$1"
  for _ in $(seq 1 60); do
    if api_alive; then return 0; fi
    if ! pid_alive "$pid"; then return 1; fi
    sleep 0.5
  done
  return 1
}

print_status() {
  local pid armed_prod armed_daemon state="stopped"
  pid="$(pid_from_file)"
  if pid_alive "$pid"; then state="running"; fi
  armed_prod="$(config_flag "$ARMED_CONFIG")"
  armed_daemon="$(config_flag "$CONFIG")"
  printf 'state=%s\n' "$state"
  printf 'pid=%s\n' "$pid"
  printf 'port=%s\n' "$PORT"
  printf 'bind=%s\n' "$BIND_HOST"
  printf 'hostname=%s\n' "$DAEMON_HOSTNAME"
  printf 'config=%s\n' "$CONFIG"
  printf 'armed_config=%s\n' "$ARMED_CONFIG"
  printf 'log=%s\n' "$LOG_FILE"
  printf 'pidfile=%s\n' "$PID_FILE"
  printf 'entry=%s\n' "$ENTRY"
  printf 'armed=%s\n' "$armed_prod"
  printf 'daemon_armed=%s\n' "$armed_daemon"
  if command -v git >/dev/null 2>&1; then printf 'git=ok\n'; else printf 'git=missing\n'; fi
  if command -v docker >/dev/null 2>&1; then printf 'docker=ok\n'; else printf 'docker=missing\n'; fi
  if [[ "$state" == "running" ]]; then return 0; fi
  return 3
}

preflight() {
  [[ -f "$ENTRY" ]] || die "engine entry not found: $ENTRY (set LOOPARR_SELFHEAL_ENTRY)"
  command -v node >/dev/null 2>&1 || die "node is required on the host"
  # The standby engine creates git worktrees and builds the heal preview stack,
  # so both binaries must be on the host PATH.
  command -v git >/dev/null 2>&1 || die "git is required on the host for worktree isolation"
  command -v docker >/dev/null 2>&1 || die "docker is required on the host for the heal preview stack"
  if [[ "$DAEMON_HOSTNAME" == "$PROD_HOSTNAME" ]]; then
    die "standby hostname '$DAEMON_HOSTNAME' must differ from the prod hostname '$PROD_HOSTNAME' (it is what marks the standby as foreign)"
  fi
  [[ -n "$ARMED_CONFIG" && -f "$ARMED_CONFIG" ]] || die "no arming config found; set LOOPARR_SELFHEAL_ARMED_CONFIG"
}

sync_config() {
  if [[ "$(config_flag "$ARMED_CONFIG")" != "on" ]]; then
    die "settings.selfHealing is off in $ARMED_CONFIG; enable 'Self-healing debugging mode' in Settings, then run start again"
  fi
  if [[ "$CONFIG" == "$ARMED_CONFIG" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "$CONFIG")"
  local temp="$CONFIG.tmp.$$"
  cp "$ARMED_CONFIG" "$temp"
  chmod 600 "$temp"
  mv "$temp" "$CONFIG"
}

start_daemon() {
  local pid
  pid="$(pid_from_file)"
  if pid_alive "$pid"; then
    log "already running (pid $pid)"
    print_status
    return 0
  fi
  if [[ -e "$PID_FILE" ]]; then
    log "removing stale pid file $PID_FILE"
    rm -f "$PID_FILE"
  fi
  if api_alive; then
    die "port $PORT already answers /api/state, but no PID file owns it; stop that process first"
  fi
  preflight
  sync_config
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"

  # A dedicated standby must not adopt the primary's tasks; it only reacts to
  # fresh foreign errored checkpoints. NODE_ENV=development matches the
  # documented host recipe; LOOPARR_SELFHEAL=1 is what actually arms spawning.
  export NODE_ENV=development
  export LOOPARR_SELFHEAL=1
  export LOOPARR_SELFHEAL_STANDBY=1
  export HOSTNAME="$DAEMON_HOSTNAME"
  export HOST="$BIND_HOST"
  export PORT
  export CONFIG_PATH="$CONFIG"
  export LOOPARR_PROJECTS_ROOT="${LOOPARR_PROJECTS_ROOT:-/home/michaelpeele/ai-projects}"

  log "starting standby healer on $BIND_HOST:$PORT as hostname $DAEMON_HOSTNAME"
  setsid bash -c 'printf "%s\n" "$$" > "$1"; exec "$2" "$3"' \
    _ "$PID_FILE" "$(command -v node)" "$ENTRY" \
    >>"$LOG_FILE" 2>&1 < /dev/null &
  local launcher=$!

  for _ in $(seq 1 40); do
    [[ -s "$PID_FILE" ]] && break
    sleep 0.25
  done
  pid="$(pid_from_file)"
  if ! pid_alive "$pid"; then
    log "standby exited during startup; last log lines:"
    tail -n 20 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  if ! wait_ready "$pid"; then
    log "standby did not answer http://127.0.0.1:$PORT/api/state; last log lines:"
    tail -n 20 "$LOG_FILE" >&2 || true
    stop_daemon
    exit 1
  fi
  if ! api_armed; then
    log "engine is up but selfHealingAvailable is false; stopping"
    stop_daemon
    exit 1
  fi
  log "running (pid $pid)"
  print_status
}

stop_daemon() {
  local pid
  pid="$(pid_from_file)"
  if ! pid_alive "$pid"; then
    log "not running"
    rm -f "$PID_FILE"
    return 0
  fi
  log "stopping pid $pid"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    if ! pid_alive "$pid"; then
      rm -f "$PID_FILE"
      log "stopped"
      return 0
    fi
    sleep 0.5
  done
  log "pid $pid ignored SIGTERM; sending SIGKILL"
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  log "killed"
}

install_unit() {
  local unit="$UNIT_DIR/looparr-selfheal.service"
  mkdir -p "$UNIT_DIR"
  cat > "$unit" <<EOF
[Unit]
Description=Looparr standby self-heal engine (host)
Documentation=file://$ROOT/SELFHEALING.md
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=forking
PIDFile=$PID_FILE
WorkingDirectory=$ROOT
ExecStart=$ROOT/scripts/selfheal-daemon.sh start
ExecStop=$ROOT/scripts/selfheal-daemon.sh stop
Restart=on-failure
RestartSec=10
TimeoutStartSec=120

[Install]
WantedBy=default.target
EOF
  log "wrote $unit"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload >/dev/null 2>&1 || log "systemctl --user daemon-reload failed; run it yourself"
  fi
  cat <<EOF
Next steps (systemd --user):
  systemctl --user enable --now looparr-selfheal
  systemctl --user status looparr-selfheal
To survive logout/reboot without an active session:
  sudo loginctl enable-linger \$USER
The unit runs '$ROOT/scripts/selfheal-daemon.sh start', which syncs the
'Self-healing debugging mode' setting from $ARMED_CONFIG.
EOF
}

command="${1:-}"
case "$command" in
  start) start_daemon ;;
  stop) stop_daemon ;;
  restart) stop_daemon; start_daemon ;;
  status) print_status ;;
  install) install_unit ;;
  -h|--help|help|'') usage ;;
  *) usage >&2; exit 2 ;;
esac
