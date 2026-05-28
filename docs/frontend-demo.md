# OmniETF Frontend Demo

## What this adds

The frontend is a local browser lifecycle visualizer for the existing Foundry PoC. It does not connect to a wallet and does not use a live bridge. It uses the public default Anvil private key so presenters can run every step with deterministic local contracts.

```text
Browser UI
  ↓ viem JSON-RPC
Anvil 31337
  ├─ OmniETFManager
  ├─ MockBridgeAdapter
  └─ MockSolanaPortfolio
```

## Prerequisites

- Foundry installed: `anvil`, `forge`
- Node/npm installed
- Dependencies installed with `npm install`

## Terminal 1 — start Anvil

```bash
npm run dev:anvil
```

Keep this terminal running.

## Terminal 2 — deploy local contracts

```bash
npm run deploy:local
```

This command:

1. runs `forge build`,
2. deploys MockUSDC, MockPriceOracle, OmniETFShare, OmniETFManager, MockSolanaPortfolio, and MockBridgeAdapter,
3. initializes asset prices and contract permissions,
4. mints 1,000 mock USDC to the demo Anvil account,
5. writes `deployments/local.json` for the frontend.

## Terminal 3 — start frontend

```bash
npm run web:dev
```

Open the URL printed by Vite, usually:

```text
http://localhost:5173
```

## One-command convenience mode

For a quick local run, this starts Anvil, deploys contracts, and starts Vite:

```bash
npm run demo:web
```

Use separate terminals if you want clearer logs while presenting.

## UI demo order

Click buttons in this order:

1. **Approve USDC**
2. **Request Deposit**
3. **Execute Allocation**
4. **Ack Allocation**
5. **Run Price Sync + Rebalance**
6. **Request Redeem**
7. **Execute Remote Sell**
8. **Ack Redeem**
9. **Claim USDC**

## What each step proves

| UI step | Meaning |
| --- | --- |
| Approve USDC | Demo account allows manager to escrow deposit assets. |
| Request Deposit | Base manager records a pending deposit and sends a mock bridge allocation message. |
| Execute Allocation | Mock bridge asks mock Solana portfolio to allocate USDC value into AAPLx/TSLAx/NVDAx. |
| Ack Allocation | Base manager receives the reserve snapshot and mints mETF shares. |
| Price Sync + Rebalance | Mock oracle price changes, remote portfolio rebalances, manager receives updated NAV snapshot. |
| Request Redeem | Shares are burned and a pending redeem message is sent. |
| Execute Remote Sell | Mock Solana portfolio sells pro-rata remote reserves. |
| Ack Redeem | USDC becomes claimable on the manager. |
| Claim USDC | User receives returned mock USDC. |

## Important limitations

- The frontend uses a default Anvil private key from `deployments/local.json`. This is safe only for local demos.
- `MockSolanaPortfolio` is a Solidity mock, not an Anchor/SVM program.
- `MockBridgeAdapter` is a message/ack simulator, not CCIP/Wormhole/LayerZero.
- NAV changes only after an acknowledged snapshot, matching the async accounting model.

## Troubleshooting

### UI says “Check local Anvil”

Make sure Anvil is running:

```bash
npm run dev:anvil
```

### Contract calls revert after restarting Anvil

Redeploy and refresh the browser:

```bash
npm run deploy:local
```

### Frontend build fails because deployment JSON is missing

Create it first:

```bash
npm run dev:anvil
npm run deploy:local
npm run build:web
```

## Local EVM↔SVM mode

For the cross-runtime demo, use:

```bash
npm run demo:cross-local
```

Then open `http://localhost:5173`. The UI switches to Local EVM↔SVM mode when `deployments/local.json` was generated with `BRIDGE_MODE=svm`.

In this mode the main deposit button sequence is:

1. **EVM Approve USDC**
2. **EVM Request Deposit / Lock**
3. **Relay → SVM Swap → Ack Mint**

The redeem sequence is:

1. **EVM Request Redeem / Burn**
2. **Relay → SVM Sell/Burn → Ack Return**
3. **EVM Claim USDC**

The browser talks to the local relayer at `http://127.0.0.1:8787`, and the relayer talks to `solana-test-validator`. See `docs/local-evm-svm.md` for the full runbook.
