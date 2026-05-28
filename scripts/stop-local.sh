#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
for pidfile in .omx/run/vite.pid .omx/run/relayer.pid .omx/run/anvil.pid .omx/run/solana.pid; do
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "stopping $pidfile pid $pid"
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
done
pkill -f '[s]cripts/relayer-local.ts' 2>/dev/null || true
pkill -f '[v]ite apps/web' 2>/dev/null || true
pkill -f '[a]nvil --chain-id 31337' 2>/dev/null || true
pkill -f '[s]olana-test-validator' 2>/dev/null || true
