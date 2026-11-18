#!/usr/bin/env bash
# Build and (re)start the web app on :3000 in production mode. Logs: /workspace/.atlas-run/web.log (override LOG_DIR).
set -euo pipefail
cd "$(dirname "$0")/../apps/web"
LOG_DIR="${LOG_DIR:-/workspace/.atlas-run}"; mkdir -p "$LOG_DIR"
pkill -f "next-server" 2>/dev/null || true; pkill -f "next start" 2>/dev/null || true; sleep 1
[ "${SKIP_BUILD:-0}" = "1" ] || NODE_ENV=production npx next build
NODE_ENV=production nohup npx next start -p "${WEB_PORT:-3000}" > "$LOG_DIR/web.log" 2>&1 &
echo "web started pid $!"
