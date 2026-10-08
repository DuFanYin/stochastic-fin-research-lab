#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
SERVER_DIR="$PROJECT_ROOT/server"
ENGINE_DIR="$PROJECT_ROOT/engine"
PORT="${PORT:-8000}"
DO_BUILD="${1:-}"

# Build C++ engine only when explicitly requested:
#   ./run.sh build
if [ "$DO_BUILD" = "build" ] && [ -d "$ENGINE_DIR" ]; then
  cd "$ENGINE_DIR"

  # If the project folder was renamed/moved, old CMake cache can be stale.
  if [ -f "build/CMakeCache.txt" ]; then
    CACHED_SRC="$(awk -F= '/^CMAKE_HOME_DIRECTORY:INTERNAL=/{print $2}' build/CMakeCache.txt | tail -n 1)"
    if [ -n "${CACHED_SRC:-}" ] && [ "$CACHED_SRC" != "$ENGINE_DIR" ]; then
      echo "Detected stale CMake cache (source: $CACHED_SRC). Recreating build directory."
      rm -rf build
    fi
  fi

  cmake -S . -B build -DCMAKE_BUILD_TYPE="Release"
  cmake --build build -j >/dev/null
  echo "C++ build completed: $ENGINE_DIR/build (Release)"
fi

if [ ! -d "$SERVER_DIR" ]; then
  echo "server not found under project root: $PROJECT_ROOT"
  exit 1
fi

cd "$SERVER_DIR"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate

# If Python was upgraded/removed, existing venv scripts can carry stale shebangs.
# Recreate venv when pip launcher is missing or broken.
if [ ! -x ".venv/bin/python" ] || ! ".venv/bin/python" -m pip --version >/dev/null 2>&1; then
  echo "Detected broken virtual environment. Recreating .venv ..."
  rm -rf .venv
  python3 -m venv .venv
  source .venv/bin/activate
fi

".venv/bin/python" -m pip install -r requirements.txt >/dev/null

# Auto-clear previous local server processes occupying the target port.
PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "${PIDS:-}" ]; then
  echo "Port $PORT is in use. Stopping existing process(es): $PIDS"
  kill $PIDS 2>/dev/null || true
  sleep 1
  STILL_PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${STILL_PIDS:-}" ]; then
    kill -9 $STILL_PIDS 2>/dev/null || true
  fi
fi

exec ".venv/bin/python" -m uvicorn main:app --reload --port "$PORT"

