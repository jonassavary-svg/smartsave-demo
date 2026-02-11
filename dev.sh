#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8081}"
export PORT
IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
echo "Dev server: http://${IP:-localhost}:$PORT/index.html"
python3 dev_server.py
