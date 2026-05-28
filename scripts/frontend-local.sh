#!/usr/bin/env sh
set -eu
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

ANVIL_LOG="${TMPDIR:-/tmp}/omnietf-anvil.log"
anvil --chain-id 31337 --host 127.0.0.1 --port 8545 > "$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
cleanup() {
  kill "$ANVIL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1
npm run deploy:local
npm run web:dev
