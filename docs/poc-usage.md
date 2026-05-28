# OmniETF PoC Usage Guide

## Prerequisites

- Foundry installed: `forge` and `anvil` must be available.
- Node/npm are only needed for the convenience scripts in `package.json`.

Check:

```bash
forge --version
npm --version
```

## Run tests

From the repository root:

```bash
npm run test:contracts
```

Equivalent direct command:

```bash
cd contracts
forge test
```

## Run the deterministic PoC demo

```bash
npm run demo:local
```

This runs:

1. `forge test`
2. `forge script contracts/script/Demo.s.sol -vvvv`

The script emits demo events for deployed addresses, deposit request id, share balances, NAV, redeem request id, and claim amount.

## Public lifecycle

### Deposit

```text
User approves MockUSDC to OmniETFManager
User calls requestDeposit(assets)
Manager transfers USDC to MockBridgeAdapter escrow
MockBridgeAdapter records allocation message
Demo/test calls executeAllocation(requestId)
MockSolanaPortfolio updates synthetic AAPLx/TSLAx/NVDAx balances
Demo/test calls ackAllocation(requestId)
Manager settles snapshot and mints mETF shares
```

Important: shares are **not minted immediately** at request time. They are minted after remote allocation acknowledgement.

### Redeem

```text
User calls requestRedeem(shares)
Manager burns shares and sends redeem intent
Demo/test calls executeRedeem(requestId)
MockSolanaPortfolio sells pro-rata portfolio value
Demo/test calls ackRedeem(requestId)
Manager marks USDC claimable
User calls claimRedeem(requestId)
```

### Rebalance / price sync

```text
Owner updates MockPriceOracle if needed
Owner calls requestRebalance()
Demo/test calls executeRebalance(requestId)
Demo/test calls ackRebalance(requestId)
Manager stores the new acknowledged snapshot
```

## Method cheat sheet

| Contract | Method | Who calls | Purpose |
| --- | --- | --- | --- |
| `MockUSDC` | `mint(to, amount)` | anyone in PoC | Give demo users USDC. |
| `MockUSDC` | `approve(manager, amount)` | user | Allow manager to escrow deposits. |
| `OmniETFManager` | `requestDeposit(assets)` | user | Start async allocation. |
| `MockBridgeAdapter` | `executeAllocation(requestId)` | owner/demo | Simulate remote Solana allocation. |
| `MockBridgeAdapter` | `ackAllocation(requestId)` | owner/demo | Return allocation ack to Base manager. |
| `OmniETFManager` | `requestRedeem(shares)` | user | Burn shares and start remote sell. |
| `MockBridgeAdapter` | `executeRedeem(requestId)` | owner/demo | Simulate remote pro-rata sell. |
| `MockBridgeAdapter` | `ackRedeem(requestId)` | owner/demo | Return sell ack and USDC to manager. |
| `OmniETFManager` | `claimRedeem(requestId)` | user | Claim returned USDC. |

## Units

- USDC uses 6 decimals.
- mETF shares use 18 decimals.
- Mock asset prices use 18-decimal USD WAD.
- Target weights use basis points and must sum to `10_000`.
