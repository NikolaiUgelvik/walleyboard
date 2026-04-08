#!/usr/bin/env bash

set -euo pipefail

STATE_DIR="${WALLEYBOARD_HOME:-$HOME/.walleyboard}"
RUN_DIR="$STATE_DIR/dev"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_PORT=4000
FRONTEND_PORT=5173

# Stop a service by finding the actual process listening on its port (most
# reliable), falling back to the PID file.  Waits up to 10 seconds for a
# graceful shutdown before force-killing.
stop_service() {
  local name="$1"
  local pid_file="$2"
  local port="$3"

  local saved_pid=""
  if [[ -f "$pid_file" ]]; then
    saved_pid="$(cat "$pid_file")"
    rm -f "$pid_file"
  fi

  # The process that actually owns the port is the one we need to signal.
  # The PID file may point at a setsid/nohup wrapper that already exited.
  local listener_pid
  listener_pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)"

  local target_pid="${listener_pid:-$saved_pid}"

  if [[ -z "$target_pid" ]] || ! kill -0 "$target_pid" 2>/dev/null; then
    return 0
  fi

  echo "Stopping $name (pid $target_pid)..."
  kill "$target_pid" 2>/dev/null || true

  # Wait up to 10 seconds for the process to exit and the port to free up.
  for _ in $(seq 1 40); do
    if ! kill -0 "$target_pid" 2>/dev/null &&
       ! lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$name stopped."
      return 0
    fi
    sleep 0.25
  done

  echo "$name did not exit after SIGTERM, forcing stop."
  kill -KILL "$target_pid" 2>/dev/null || true

  # Also force-kill any remaining listeners on the port (e.g. children that
  # inherited the socket).
  local remaining
  remaining="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$remaining" ]]; then
    echo "$remaining" | xargs kill -KILL 2>/dev/null || true
  fi
}

mkdir -p "$RUN_DIR"

stop_service "frontend" "$FRONTEND_PID_FILE" "$FRONTEND_PORT"
stop_service "backend" "$BACKEND_PID_FILE" "$BACKEND_PORT"

echo "All managed dev servers are stopped."
