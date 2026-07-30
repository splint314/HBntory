#!/usr/bin/env bash
#
# Launch every HBntory service locally (no Docker needed) for dev/demo use.
# Assumes each service's venv already exists (see LANCEMENT.md / README.md
# "Option B" if not). product_mcp/ and ai_service/ each have their own
# .venv/ in-place; the Backoffice's venv lives at the repo root instead
# (created via `cd backoffice && python3 -m venv ../.venv`), which is why
# it's addressed as ../.venv below rather than backoffice/.venv.
#
# Usage: ./launch_all.sh [stop]
#   ./launch_all.sh        start everything, stream logs, Ctrl+C stops all of it
#   ./launch_all.sh stop   kill anything left over from a previous run

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT/run-logs"
PID_FILE="$LOG_DIR/pids"

PRODUCT_API_PORT=5001
BACKOFFICE_PORT=5000
AI_SERVICE_PORT=5002
CLIENT_WEB_PORT=5173
OLLAMA_HOST_URL="http://127.0.0.1:11434"
AI_MODEL="${AI_MODEL:-llama3.1:8b}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe123!}"

mkdir -p "$LOG_DIR"

stop_all() {
  if [ -f "$PID_FILE" ]; then
    echo "Stopping previously launched services..."
    while read -r pid; do
      kill -9 "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  # Also free the ports in case a process was started outside this script.
  for port in $PRODUCT_API_PORT $BACKOFFICE_PORT $AI_SERVICE_PORT $CLIENT_WEB_PORT; do
    fuser -k "${port}/tcp" 2>/dev/null || true
  done
}

if [ "${1:-}" = "stop" ]; then
  stop_all
  echo "All stopped."
  exit 0
fi

stop_all
: > "$PID_FILE"

start() {
  local name="$1" dir="$2" log="$LOG_DIR/$1.log"; shift 2
  echo "Starting $name..."
  (cd "$dir" && "$@") > "$log" 2>&1 &
  echo $! >> "$PID_FILE"
}

wait_for() {
  local name="$1" url="$2" tries=30
  until curl -fs "$url" >/dev/null 2>&1; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      echo "  ! $name did not become ready at $url — check $LOG_DIR/$name.log"
      return 1
    fi
    sleep 1
  done
  echo "  $name is up ($url)"
}

trap 'trap - INT TERM; echo; echo "Stopping everything..."; stop_all; exit 0' INT TERM

# 1. External Product API (stdlib only, no venv needed)
start product_api "$ROOT/product_api" env HBN_PRODUCTS_PORT=$PRODUCT_API_PORT python3 app.py
wait_for product_api "http://127.0.0.1:$PRODUCT_API_PORT/health"

# 2. Backoffice: seed once (idempotent), then serve
if [ ! -f "$ROOT/backoffice/hbntory.db" ]; then
  echo "Seeding Backoffice database (admin / $ADMIN_PASSWORD)..."
  (cd "$ROOT/backoffice" && ADMIN_PASSWORD="$ADMIN_PASSWORD" ../.venv/bin/python seed.py) \
    >> "$LOG_DIR/backoffice.log" 2>&1
fi
start backoffice "$ROOT/backoffice" env \
  SECRET_KEY="change-me-in-production" \
  PRODUCT_API_URL="http://127.0.0.1:$PRODUCT_API_PORT" \
  ../.venv/bin/python app.py
wait_for backoffice "http://127.0.0.1:$BACKOFFICE_PORT/"

# 3. Ollama: start if not already running, make sure the model is pulled
if ! curl -fs "$OLLAMA_HOST_URL/api/tags" >/dev/null 2>&1; then
  echo "Starting Ollama..."
  nohup ollama serve > "$LOG_DIR/ollama.log" 2>&1 &
  echo $! >> "$PID_FILE"
  wait_for ollama "$OLLAMA_HOST_URL/api/tags"
else
  echo "Ollama already running at $OLLAMA_HOST_URL"
fi
echo "Ensuring model $AI_MODEL is available (skips if already pulled)..."
OLLAMA_HOST="$OLLAMA_HOST_URL" AI_MODEL="$AI_MODEL" \
  "$ROOT/ai_service/.venv/bin/python" "$ROOT/ai_service/ensure_model.py"

# 4. AI Query Service
start ai_service "$ROOT/ai_service" env \
  OLLAMA_HOST="$OLLAMA_HOST_URL" \
  AI_MODEL="$AI_MODEL" \
  PRODUCT_API_URL="http://127.0.0.1:$PRODUCT_API_PORT" \
  DATABASE_URL="sqlite:///$ROOT/backoffice/hbntory.db" \
  AI_SERVICE_PORT=$AI_SERVICE_PORT \
  .venv/bin/python app.py
wait_for ai_service "http://127.0.0.1:$AI_SERVICE_PORT/health"

# 5. Client web (static)
start client_web "$ROOT/client_web" python3 -m http.server $CLIENT_WEB_PORT
wait_for client_web "http://127.0.0.1:$CLIENT_WEB_PORT/"

cat <<EOF

All services are up:
  Product API      http://127.0.0.1:$PRODUCT_API_PORT
  Backoffice       http://127.0.0.1:$BACKOFFICE_PORT   (admin / $ADMIN_PASSWORD)
  Ollama           $OLLAMA_HOST_URL   (model: $AI_MODEL)
  AI Query Service http://127.0.0.1:$AI_SERVICE_PORT
  Client Web       http://127.0.0.1:$CLIENT_WEB_PORT

Logs: $LOG_DIR/<service>.log
Ctrl+C to stop everything, or run './launch_all.sh stop' from another shell.
EOF

wait
