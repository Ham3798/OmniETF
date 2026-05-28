#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p .omx/run deployments

ANVIL_LOG=.omx/run/anvil.log
SOLANA_LOG=.omx/run/solana-test-validator.log
RELAYER_LOG=.omx/run/relayer.log
VITE_LOG=.omx/run/vite.log

start_bg() {
  local name="$1"
  local pidfile="$2"
  local logfile="$3"
  shift 3
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "$name already running pid $(cat "$pidfile")"
    return
  fi
  echo "starting $name"
  "$@" >"$logfile" 2>&1 &
  echo $! >"$pidfile"
}

cleanup() {
  ./scripts/stop-local.sh >/dev/null 2>&1 || true
}
trap cleanup INT TERM EXIT

npm run build:svm
PROGRAM_ID="$(solana address -k programs/omnietf-portfolio/target/deploy/omnietf_portfolio-keypair.json)"
start_bg anvil .omx/run/anvil.pid "$ANVIL_LOG" anvil --chain-id 31337 --host 127.0.0.1 --port 8545
start_bg solana-test-validator .omx/run/solana.pid "$SOLANA_LOG" solana-test-validator --reset --quiet --bpf-program "$PROGRAM_ID" programs/omnietf-portfolio/target/deploy/omnietf_portfolio.so

sleep 5
SKIP_SVM_BUILD=1 PRELOADED_SVM_PROGRAM=1 npm run deploy:svm
BRIDGE_MODE=svm npm run deploy:local
start_bg relayer .omx/run/relayer.pid "$RELAYER_LOG" ./node_modules/.bin/tsx scripts/relayer-local.ts
start_bg vite .omx/run/vite.pid "$VITE_LOG" ./node_modules/.bin/vite apps/web --config apps/web/vite.config.ts --host 0.0.0.0

echo "OmniETF local EVM↔SVM demo is on."
echo "UI: http://localhost:5173"
echo "Relayer: http://127.0.0.1:8787/health"
echo "Logs: .omx/run/*.log"
echo "Stop with Ctrl-C here or run: npm run stop:local"

wait
