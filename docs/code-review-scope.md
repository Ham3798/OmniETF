# OmniETF Code Review Scope

## What is end-to-end today

This repository demonstrates an ETF-like cross-chain basket share, not a legal ETF or a production vault.

Implemented flow:

1. User requests a Base Sepolia USDC deposit.
2. Base vault/router calls Circle CCTP V2 `depositForBurn`.
3. USDC is received by an existing Solana devnet USDC token account.
4. Local portfolio scripts allocate that received USDC into a fixed mock xStock basket.
5. Solana devnet mock SPL mints represent `AAPLx`, `TSLAx`, and `NVDAx` custody.
6. A trusted reporter finalizes the executed Solana value back into the Base vault.
7. User/operator claims canonical `mETF` shares from the executed value and current NAV through standard `deposit` / `mint`.
8. User can request redeem; reporter funds the payout and marks it claimable; user claims USDC through standard `redeem` / `withdraw`.

There are two vault implementations in the review:

- `OmniETFAsyncVault` is the operational PoC vault. It hand-implements the ERC-7540/ERC-7575 surface and includes OpenZeppelin `AccessControl` roles.
- `OmniETFOZAsyncVault` is the standards-aligned target. It inherits OpenZeppelin Community Contracts' `ERC7540` base directly, then adds the OmniETF CCTP route, reporter settlement, redeem payout reservation, executed-value accounting, and OpenZeppelin `AccessManager` operation controls around that base.

## Core invariant

The review should check whether the implementation preserves:

```text
one canonical mETF supply
one NAV/share value on Base
one async lifecycle for cross-chain execution finality
```

## Main files

- `contracts/OmniETFAsyncVault.sol`
  - OpenZeppelin `mETF` ERC-20 share token
  - async deposit states: `Pending -> Settled -> Claimable -> Claimed`
  - async redeem states: `Pending -> Claimable -> Claimed`
  - ERC-7540 request IDs, operator approval, pending/claimable views, and standard claim functions
  - ERC-7575 `asset`, `share`, `totalAssets`, max, deposit, mint, withdraw, and redeem surface
  - ERC-7540 async preview behavior: preview functions revert while max functions expose claimable limits
  - OpenZeppelin `Ownable`, `AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, plus ERC-165 interface reporting
  - NAV math: `assets <-> shares`
  - trusted reporter boundary

- `contracts/OmniETFOZAsyncVault.sol`
  - official OpenZeppelin Community Contracts `ERC7540` base
  - OZ-owned ERC-20 shares, ERC-4626/ERC-7575 routing, operator authorization, async preview reverts, and pending/claimable aggregate accounting
  - CCTP `depositForBurn` request initiation using a controller-configured Solana USDC token account
  - reporter-driven `Pending -> Settled -> Claimable -> Claimed` deposit execution
  - deposit claims close the original requested assets while minting shares from the executed Solana value
  - redeem request escrow, reporter-funded payout reservation, and standard `redeem` / `withdraw` payout claims
  - `Ownable`, `AccessManaged`/`AccessManager`, `Pausable`, `ReentrancyGuard`, and `SafeERC20` around the official ERC-7540 base

- `contracts/CctpDepositRouter.sol`
  - minimal wrapper around Circle `TokenMessengerV2.depositForBurn`
  - useful for reviewing CCTP call shape independently from the vault

- `scripts/portfolio-core.mjs`
  - fixed basket: `AAPLx 40% / TSLAx 30% / NVDAx 30%`
  - NAV summary
  - redeem quote math

- `scripts/xstock-devnet.mjs`
  - creates and mints devnet mock SPL xStock tokens
  - this is visible Solana custody, not issuer-backed xStock

- `scripts/receive-cctp-solana.mjs`
  - submits Circle CCTP V2 `receiveMessage` on Solana devnet

## Review questions

1. Does `requestDeposit` avoid minting before cross-chain execution is known?
2. Does standard `deposit` / `mint` claim from executed value using NAV before the claim?
3. Do `pendingDepositRequest`, `claimableDepositRequest`, `pendingRedeemRequest`, and `claimableRedeemRequest` report the correct state by request ID?
4. Are reporter-only transitions limited to settlement/finalization checkpoints?
5. Does redeem escrow shares first, then require funded and reserved vault USDC before burn and payout?
6. Does ERC-20 allowance alone fail to authorize a third party as deposit `owner`, while explicit ERC-7540 operator approval works and revocation removes access?
7. Are ERC-7575 max/accounting views bounded by async claimable balances rather than synchronous user balances, while async preview functions revert?
8. Are zero values, invalid recipients, invalid fees, wrong actors, and duplicate finalization rejected?
9. Do docs and slides avoid claiming production ETF or real issuer-backed xStock execution?
10. Does the official-base vault preserve the same lifecycle while relying on OZ `ERC7540` rather than a custom clone of the standard surface?

## Known non-production boundaries

- The reporter is trusted.
- Mock xStocks are devnet SPL mints.
- Price inputs are static/mock.
- Real issuer-backed Solana asset sale is future work; the mock sale, Solana -> Base CCTP script surface, Base vault `fundRedeemPayout`/`markRedeemClaimable`, reserved payout accounting, and payout claims are tested or dry-run checked locally.
- CCIP is not used in the current execution path.
- `OmniETFOZAsyncVault` uses OpenZeppelin `AccessManager` roles instead of `AccessControl`; the older PoC vault remains the `AccessControl` implementation. This avoids the `AccessControl`/Community `ERC7540` inheritance conflict while keeping role-based operation controls.

## Verification

Run:

```bash
npm run review:check
```

Expected current result:

```text
forge fmt --check: passed
forge test: 28 passed
portfolio self-test passed
```
