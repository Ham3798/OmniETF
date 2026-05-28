# OmniETF PoC Architecture

## Purpose

This PoC demonstrates a multichain ETF accounting pattern:

- **Base / EVM manager side** keeps the canonical OmniETF share supply.
- **Remote execution side** can be either a Solidity mock or a local SVM program.
- **Bridge** is represented by an asynchronous message/ack boundary.

The MVP is intentionally **ERC-4626-inspired**, not a production ERC-4626 implementation. Cross-chain settlement is asynchronous, so the public lifecycle uses request/settle/claim steps instead of synchronous `deposit()` and `redeem()`.

## Local topologies

### EVM-only deterministic mock

```text
Anvil / Foundry EVM
├─ OmniETFManager
├─ OmniETFShare
├─ MockUSDC
├─ MockPriceOracle
├─ MockBridgeAdapter
└─ MockSolanaPortfolio
```

### Local EVM↔SVM integration

```text
Anvil / Foundry EVM
├─ OmniETFManager
├─ OmniETFShare
├─ MockUSDC
└─ LocalSvmBridgeAdapter
       ↓ trusted local relayer
solana-test-validator
└─ omnietf-portfolio program state
```

`LocalSvmBridgeAdapter` stores outbound intents and accepts owner-submitted settlement snapshots from the local relayer. The SVM program tracks synthetic AAPLx/TSLAx/NVDAx reserve values and supports allocate, sell pro-rata, and rebalance instructions.

## Contracts and programs

| File | Role |
| --- | --- |
| `contracts/src/OmniETFManager.sol` | Canonical share accounting and async deposit/redeem/rebalance lifecycle. |
| `contracts/src/OmniETFShare.sol` | ERC20-like share token minted/burned only by the manager. |
| `contracts/src/mocks/MockBridgeAdapter.sol` | EVM-only message queue + mock remote executor for deterministic tests. |
| `contracts/src/LocalSvmBridgeAdapter.sol` | Local trusted-relayer EVM adapter for solana-test-validator demos. |
| `contracts/src/mocks/MockSolanaPortfolio.sol` | Solidity mock standing in for Solana in the EVM-only path. |
| `programs/omnietf-portfolio/src/lib.rs` | Native Solana program for local SVM synthetic basket accounting. |
| `scripts/relayer-local.ts` | TypeScript relayer/API that executes SVM instructions and submits EVM acks. |

## Core invariant

After acknowledged settlement:

```text
shareSupply * navPerShare ~= acknowledgedRemoteReserveValue
                           + managerHeldUSDC
                           - pendingClaimableUSDC
```

Pending cross-chain messages do not count as settled reserve value.

## Bridge boundary

The manager only relies on three outbound intents:

- `sendAllocation(requestId, user, usdcAmount)`
- `sendRedeem(requestId, user, shares, estimatedUsdc)`
- `sendRebalance(requestId)`

And three settlement callbacks:

- `settleDeposit(requestId, snapshot)`
- `settleRedeem(requestId, assetsReturned, snapshot)`
- `settleRebalance(requestId, snapshot)`

The current local EVM↔SVM path proves this boundary with a trusted relayer. A production follow-up would replace `LocalSvmBridgeAdapter` with a CCIP/Wormhole/LayerZero/Hyperlane-style verified message adapter.
