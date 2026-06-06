#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

EVM_DEPLOYMENT_FILE="${EVM_DEPLOYMENT_FILE:-deployments/base-sepolia.json}"
SVM_DEPLOYMENT_FILE="${SVM_DEPLOYMENT_FILE:-deployments/svm-devnet.json}"
RELAYER_PORT="${RELAYER_PORT:-8787}"
RELAYER_URL="${VITE_RELAYER_URL:-http://127.0.0.1:${RELAYER_PORT}}"

if [[ ! -f "$EVM_DEPLOYMENT_FILE" ]]; then
  echo "missing $EVM_DEPLOYMENT_FILE; run npm run deploy:base-sepolia first" >&2
  exit 1
fi
if [[ ! -f "$SVM_DEPLOYMENT_FILE" ]]; then
  echo "missing $SVM_DEPLOYMENT_FILE; run npm run deploy:solana-devnet first" >&2
  exit 1
fi

mkdir -p .omx/run
if [[ -f .omx/run/relayer-testnet.pid ]] && kill -0 "$(cat .omx/run/relayer-testnet.pid)" 2>/dev/null; then
  echo "testnet relayer already running pid $(cat .omx/run/relayer-testnet.pid)"
else
  if [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
    echo "starting testnet relayer on ${RELAYER_URL} with relay/ack enabled"
  else
    echo "starting testnet relayer on ${RELAYER_URL} in read-only /state mode"
  fi
  EVM_DEPLOYMENT_FILE="$EVM_DEPLOYMENT_FILE" \
  SVM_DEPLOYMENT_FILE="$SVM_DEPLOYMENT_FILE" \
  RELAYER_PORT="$RELAYER_PORT" \
  DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:-}" \
    ./node_modules/.bin/tsx scripts/relayer-local.ts >.omx/run/relayer-testnet.log 2>&1 &
  echo $! >.omx/run/relayer-testnet.pid
  sleep 1
fi

eval "$(node --input-type=module - <<'NODE'
import { readFileSync } from 'node:fs';
const dep = JSON.parse(readFileSync(process.env.EVM_DEPLOYMENT_FILE ?? 'deployments/base-sepolia.json', 'utf8'));
const env = {
  VITE_CHAIN_NAME: dep.chainName ?? 'base-sepolia',
  VITE_EVM_CHAIN_ID: String(dep.chainId),
  VITE_EVM_RPC_URL: process.env.BASE_SEPOLIA_RPC_URL ?? dep.rpcUrl ?? 'https://sepolia.base.org',
  VITE_DEMO_MODE: dep.mode ?? 'svm',
  VITE_DEMO_USER: dep.demoUser ?? dep.deployer,
  VITE_BRIDGE_CONTRACT_NAME: dep.bridgeContractName ?? 'LocalSvmBridgeAdapter',
  VITE_MANAGER_ADDRESS: dep.contracts.OmniETFManager,
  VITE_SHARE_ADDRESS: dep.contracts.OmniETFShare,
  VITE_MOCK_USDC_ADDRESS: dep.contracts.MockUSDC,
  VITE_ORACLE_ADDRESS: dep.contracts.MockPriceOracle,
  VITE_BRIDGE_ADDRESS: dep.contracts.bridge ?? dep.contracts.LocalSvmBridgeAdapter ?? dep.contracts.MockBridgeAdapter,
  VITE_RELAYER_URL: process.env.VITE_RELAYER_URL ?? `http://127.0.0.1:${process.env.RELAYER_PORT ?? '8787'}`,
};
for (const [key, value] of Object.entries(env)) {
  console.log(`export ${key}=${JSON.stringify(value)}`);
}
NODE
)"

./node_modules/.bin/vite apps/web --config apps/web/vite.config.ts --host 0.0.0.0
