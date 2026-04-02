#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${WALLEYBOARD_HOME:-$HOME/.walleyboard}"
RUN_DIR="$STATE_DIR/dev"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_PORT=4000
FRONTEND_PORT=5173

stop_managed_process() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"
  rm -f "$pid_file"

  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    echo "$name is not running (stale pid file removed)."
    return 0
  fi

  echo "Stopping $name (pid $pid)..."
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name stopped."
      return 0
    fi
    sleep 0.25
  done

  echo "$name did not exit after SIGTERM, forcing stop."
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
}

stop_listener_on_port() {
  local name="$1"
  local port="$2"
  local listener_pids

  listener_pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$listener_pids" ]]; then
    return 0
  fi

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    if ! kill -0 "$pid" 2>/dev/null; then
      continue
    fi

    echo "Stopping $name listener on port $port (pid $pid)..."
    kill "$pid" 2>/dev/null || true

    for _ in $(seq 1 20); do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.25
    done

    if kill -0 "$pid" 2>/dev/null; then
      echo "$name listener on port $port did not exit after SIGTERM, forcing stop."
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done <<<"$listener_pids"
}

mkdir -p "$RUN_DIR"

stop_managed_process "backend" "$BACKEND_PID_FILE"
stop_managed_process "frontend" "$FRONTEND_PID_FILE"

stop_listener_on_port "backend" "$BACKEND_PORT"
stop_listener_on_port "frontend" "$FRONTEND_PORT"

echo "All managed dev servers are stopped."
