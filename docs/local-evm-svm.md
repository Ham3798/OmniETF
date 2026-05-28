# Local EVM↔SVM Demo

## What this proves

This path runs the OmniETF accounting flow across two local runtimes:

```text
Anvil EVM
  OmniETFManager + LocalSvmBridgeAdapter
        ↓ trusted local relayer
solana-test-validator
  omnietf-portfolio SVM program
```

It proves the request/ack accounting lifecycle against an actual Solana program state account. It is still a **trusted local relayer**, not a production bridge.

## One-command on/off

Start everything:

```bash
npm run demo:cross-local
```

This command:

1. builds the SVM program,
2. starts Anvil,
3. starts `solana-test-validator` with the SVM program preloaded,
4. initializes the SVM portfolio state,
5. deploys EVM contracts with `BRIDGE_MODE=svm`,
6. starts the local relayer API,
7. starts the Vite UI.

Open:

```text
http://localhost:5173
```

Stop background services:

```bash
npm run stop:local
```

Logs live under `.omx/run/*.log`.

## Manual commands

Use this when debugging each layer separately:

```bash
npm run build:svm
PROGRAM_ID="$(solana address -k programs/omnietf-portfolio/target/deploy/omnietf_portfolio-keypair.json)"
solana-test-validator --reset --quiet --bpf-program "$PROGRAM_ID" programs/omnietf-portfolio/target/deploy/omnietf_portfolio.so
```

In another terminal:

```bash
npm run dev:anvil
```

Then:

```bash
SKIP_SVM_BUILD=1 PRELOADED_SVM_PROGRAM=1 npm run deploy:svm
BRIDGE_MODE=svm npm run deploy:local
npm run relayer:local
npm run web:dev
```

## Smoke test

With Anvil and solana-test-validator running and both deployments written:

```bash
npm run smoke:cross-local
```

Expected result:

```text
cross-smoke ok: finalShare=60000000000000000000 portfolioValue=60000000
```

## UI flow

Deposit/mint lane:

1. **EVM Approve USDC** — user authorizes Manager.
2. **EVM Request Deposit / Lock** — Manager transfers USDC into `LocalSvmBridgeAdapter` escrow and emits a local SVM intent.
3. **Relay → SVM Swap → Ack Mint** — relayer calls the SVM program to allocate 40/30/30 into AAPLx/TSLAx/NVDAx synthetic values, reads SVM state, and acks EVM settlement. mETF is minted only after this ack.

Redeem/burn lane:

1. **EVM Request Redeem / Burn** — user mETF is burned and a SVM sell intent is stored.
2. **Relay → SVM Sell/Burn → Ack Return** — relayer calls SVM pro-rata sell, then sends returned USDC amount and snapshot to EVM.
3. **EVM Claim USDC** — user claims the returned USDC from Manager.

## Trust boundary

The relayer is trusted. EVM does not verify Solana state proofs. The EVM bridge adapter accepts snapshots from its owner. This is intentional for local PoC iteration before replacing the adapter with Wormhole/CCIP/etc.
