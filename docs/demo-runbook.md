# OmniETF Local Demo Runbook

## Goal

Show the complete PoC lifecycle:

```text
requestDeposit → mock bridge message → mock Solana allocation → ack → share mint
price sync / rebalance → NAV update
requestRedeem → mock Solana sell → ack → claim USDC
```

## One-command demo

```bash
npm run demo:local
```

Expected result:

- all Foundry tests pass,
- demo script executes without revert,
- verbose output includes `DemoStep` and `DemoAddress` events.

## Manual commands

```bash
cd contracts
forge test
forge script script/Demo.s.sol -vvvv
```

## What to point out during presentation

1. **Before ack, no shares are minted**
   - This models async cross-chain settlement risk.
2. **MockBridgeAdapter is a message queue + ack simulator**
   - It records messages and only calls manager settlement after remote execution.
3. **MockSolanaPortfolio is the remote reserve ledger**
   - It allocates USDC value into AAPLx 40%, TSLAx 30%, NVDAx 30% using mock prices.
4. **NAV only changes on acknowledged snapshots**
   - Price changes do not affect the manager until a rebalance/sync ack updates the snapshot.
5. **Redeem is claim-based**
   - Shares burn on request, USDC becomes claimable only after remote sell ack.

## Demo event interpretation

| Event label | Meaning |
| --- | --- |
| `manager` | Address of the local Base-side manager. |
| `mockBridge` | Address of the mock bridge adapter. |
| `mockSolanaPortfolio` | Address of the Solidity mock standing in for Solana treasury/executor. |
| `deposit request id` | Cross-chain allocation request id. |
| `shares before remote ack` | Must be zero for first deposit. |
| `shares after remote ack` | Minted mETF shares after settlement. |
| `portfolio value after deposit` | Acknowledged remote reserve value in USDC decimals. |
| `nav per share after deposit` | 18-decimal NAV per mETF share. |
| `claimable after redeem ack` | USDC waiting for user claim. |

## If a command fails

1. Run `cd contracts && forge test -vvvv` for full trace.
2. Check that no stale `out/` cache is hiding compiler changes:

```bash
cd contracts
forge clean
forge test
```

3. The PoC does not require Anvil for tests or the demo script. Use Anvil only when integrating a frontend or manual transactions.

## Browser frontend demo

After the CLI demo is working, use the frontend visualizer:

```bash
npm run dev:anvil      # terminal 1
npm run deploy:local   # terminal 2
npm run web:dev        # terminal 3
```

Then open `http://localhost:5173` and click the lifecycle buttons in order. See `docs/frontend-demo.md` for the full browser runbook.

## Local EVM↔SVM demo

To show the cross-runtime path instead of the EVM-only mock:

```bash
npm run demo:cross-local
```

Stop it with:

```bash
npm run stop:local
```

For non-UI smoke verification after services/deployments are running:

```bash
npm run smoke:cross-local
```

This proves:

```text
EVM requestDeposit
→ LocalSvmBridgeAdapter escrow + intent
→ relayer executes SVM allocate
→ relayer submits EVM ack
→ mETF mint
→ EVM requestRedeem burns mETF
→ relayer executes SVM pro-rata sell/burn
→ relayer submits returned USDC ack
→ user claims USDC
```

This remains a trusted local relayer demo, not a production bridge.
