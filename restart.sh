#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${WALLEYBOARD_HOME:-$HOME/.walleyboard}"
RUN_DIR="$STATE_DIR/dev"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$RUN_DIR/backend.log"
FRONTEND_LOG="$RUN_DIR/frontend.log"
BACKEND_PORT=4000
FRONTEND_PORT=5173

start_service() {
  local name="$1"
  local command="$2"
  local pid_file="$3"
  local log_file="$4"
  local port="$5"

  echo "Starting $name..."
  : >"$log_file"

  WALLEYBOARD_ROOT="$ROOT_DIR" \
    nohup setsid bash -lc "cd \"\$WALLEYBOARD_ROOT\" && exec $command" \
      >>"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >"$pid_file"

  for _ in $(seq 1 40); do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$name exited before it finished starting. Recent log output:"
      tail -n 20 "$log_file" || true
      return 1
    fi

    if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "$name is running on port $port (pid $pid)."
      return 0
    fi

    sleep 0.25
  done

  echo "$name did not bind to port $port in time. Recent log output:"
  tail -n 20 "$log_file" || true
  return 1
}

mkdir -p "$RUN_DIR"

"$ROOT_DIR/stop.sh"

if ! start_service \
  "backend" \
  "node --import tsx apps/backend/src/index.ts" \
  "$BACKEND_PID_FILE" \
  "$BACKEND_LOG" \
  "$BACKEND_PORT"; then
  "$ROOT_DIR/stop.sh" >/dev/null 2>&1 || true
  exit 1
fi

if ! start_service \
  "frontend" \
  "npm run dev:web" \
  "$FRONTEND_PID_FILE" \
  "$FRONTEND_LOG" \
  "$FRONTEND_PORT"; then
  "$ROOT_DIR/stop.sh" >/dev/null 2>&1 || true
  exit 1
fi

echo "Backend log: $BACKEND_LOG"
echo "Frontend log: $FRONTEND_LOG"
echo "Backend URL: http://127.0.0.1:$BACKEND_PORT"
echo "Frontend URL: http://127.0.0.1:$FRONTEND_PORT"
