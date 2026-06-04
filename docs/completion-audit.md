# OmniETF Completion Audit

## Completion target

The current target is a presentation-ready PoC, not a production ETF.

The PoC is complete when the repository can demonstrate and verify:

1. Base-side canonical mETF share supply.
2. Base -> Solana USDC settlement through CCTP.
3. Solana-side visible reserve custody for a fixed basket.
4. Reporter finalization of Solana execution value back into Base accounting.
5. NAV/share conversion that avoids minting before execution finality.
6. Redeem lifecycle states through request, claimable, and claimed payout.
7. ERC-7540 request IDs, operator approval, pending/claimable request views, and standard claim functions.
8. OpenZeppelin Community Contracts' ERC-7540 base lifecycle and OpenZeppelin-based operational primitives.
9. Documentation and slides that do not overclaim production ETF, real xStock execution, CCIP usage, or automated reverse payout.

## Requirement evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| Canonical mETF share supply exists on Base | `contracts/OmniETFAsyncVault.sol` extends OpenZeppelin `ERC20` for `mETF`, `totalSupply`, `balanceOf`, `transfer`, `approve`, `transferFrom` | Complete |
| Deposit does not mint before cross-chain execution | `requestDeposit` records `Pending` and calls CCTP; tests assert `totalSupply == 0` after request | Complete |
| CCTP settlement path exists | `CctpDepositRouter`, `OmniETFAsyncVault.requestDeposit`, and `OmniETFOZAsyncVault.requestDeposit` call Circle `TokenMessengerV2.depositForBurn`; verified Base/Solana txs recorded in `docs/cctp-router.md` and `docs/demo-runbook.md` | Complete |
| Solana reserve leg is visible | `scripts/xstock-devnet.mjs` creates devnet mock SPL mints and mints target basket balances | Complete for mock custody |
| Fixed basket is defined | `scripts/portfolio-core.mjs` defines `AAPLx 40%`, `TSLAx 30%`, `NVDAx 30%` | Complete |
| NAV/share math works | `convertToShares`, `convertToAssets`, `nav`; tests cover first deposit and NAV-before-deposit second mint | Complete |
| Official ERC-7540 base is integrated | `contracts/OmniETFOZAsyncVault.sol` inherits OpenZeppelin Community Contracts `ERC7540`; the OZ base owns ERC-20 share behavior, ERC-4626/ERC-7575 routing, operator checks, pending/claimable aggregate accounting, and async preview reverts | Complete as the standards-aligned target implementation |
| ERC-7540 request surface is represented | `OmniETFAsyncVault` implements the PoC surface, while `OmniETFOZAsyncVault` implements the same deposit/redeem lifecycle on the official OZ `ERC7540` base: standard request functions, numeric request IDs, operator approval, pending/claimable views, and standard `deposit`/`mint`/`withdraw`/`redeem` claims; tests run both lifecycles through `IERC7540`-typed handles or official sub-interface checks | Complete |
| OpenZeppelin operational primitives are used | Vault extends `ERC20`, `Ownable`, `AccessControl`, `Pausable`, `ReentrancyGuard`, and uses `SafeERC20`; ERC-165 support comes through `AccessControl` plus explicit ERC-7540/ERC-7575 `supportsInterface`; tests cover ERC-7575 accounting/max functions against async claimable balances and verify async preview functions revert per the ERC-7540 async model | Complete |
| Official-base operational wrapper exists | `OmniETFOZAsyncVault` combines the official OZ `ERC7540` base with `Ownable`, `AccessManaged`/`AccessManager`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, Circle CCTP deposit initiation, reporter settlement, Base-side redeem payout reservation, and exact executed-value managed-asset accounting | Complete |
| Reporter finalization is bounded | `markDepositSettled`, `markDepositExecuted`, `finalizeDeposit`, `markRedeemClaimable`, and `fundRedeemPayout` are reporter-gated; tests reject wrong reporter and unfunded redeem claimable transitions | Complete |
| Redeem lifecycle is represented | `requestRedeem`, `fundRedeemPayout`, `markRedeemClaimable`, standard `redeem`/`withdraw`, and compatibility `claimRedeem`; tests cover escrow, reporter-funded claimable state, direct-vault-funded claimable state, payout reservation, exact-asset withdraw, burn, and USDC payout | Complete for Base-side funding/payout path |
| Reverse settlement execution exists | `scripts/redeem-settlement.mjs --execute` subtracts mock asset sales from the portfolio ledger, records `reverseCctpBurnIntent`, emits `REDEEM_ASSETS_CLAIMABLE`, and points to `cctp:burn-solana`, `cctp:receive-evm`, and `MarkOmniETFRedeemClaimable`; portfolio self-test covers quote and execute modes | Complete for mock demo |
| Solana -> Base CCTP scripts exist | `scripts/burn-cctp-solana.mjs` submits Solana CCTP V2 `depositForBurn`; `scripts/receive-cctp-evm.mjs` fetches Circle attestation and calls Base `MessageTransmitterV2.receiveMessage` through `cast send`; `portfolio self-test` dry-runs the burn instruction shape and receive command shape without live keys | Complete for live testnet operation when funded env is present |
| Operational access control exists | `OmniETFAsyncVault` uses OpenZeppelin `AccessControl` roles for reporter/pauser plus `Ownable` admin controls; `OmniETFOZAsyncVault` uses OpenZeppelin `AccessManager` roles for restricted reporter/pauser functions; tests cover both role models | Complete |
| Official-base deployment is operationally configured | `script/DeployOmniETFOZAsyncVault.s.sol` deploys `AccessManager`, deploys `OmniETFOZAsyncVault`, labels reporter/pauser roles, grants them to `REPORTER`, and binds restricted function selectors to those roles; live Base Sepolia txs are recorded in `docs/demo-runbook.md` | Complete |
| Official-base live E2E run is complete | `OmniETFOZAsyncVault` completed Base -> Solana CCTP deposit, reporter deposit finalization, reverse CCTP redeem payout, reporter-funded redeem payout, and two redeem claims on Base Sepolia/Solana devnet; all tx hashes and scan URLs are recorded in `docs/demo-runbook.md` | Complete |
| Review can be run locally | `npm run review:check` runs `forge fmt --check`, `forge test`, and portfolio self-test | Complete |
| Presentation artifacts match current narrative | `slides.md` updated and `OmniETF.pptx` / `OmniETF.pdf` re-exported | Complete |
| Demo instructions are reproducible | `docs/demo-runbook.md` contains live sequence, verified tx evidence, and offline fallback | Complete |

## Verification command

```bash
forge fmt --check
forge test --offline
npm run portfolio:test
```

Current verified result:

```text
forge fmt --check: passed
forge test: 28 passed
portfolio self-test passed
```

Note: `npm run review:check` still represents the intended aggregate check, but the local Foundry binary can panic in this macOS sandbox while initializing external signature/proxy lookup. `forge test --offline` validates the same local Solidity tests without that external lookup path.

## Known production gaps

These are intentionally outside the current presentation-ready PoC:

- Legal ETF structure, authorized participants, regulated custody, and secondary-market operation.
- Real issuer-backed xStock purchase/sale.
- Real issuer-backed Solana asset sale. The mock sale, Solana -> Base CCTP script surface, Base vault funding, and payout path exist and are tested or dry-run checked locally.
- Permissionless reporter/oracle network.
- Dynamic rebalancing.
- CCIP arbitrary messaging control plane.
- The official-base contract deliberately uses OpenZeppelin `AccessManager` instead of `AccessControl`, because mixing `AccessControl`'s ERC-165/Context inheritance with the Community `ERC7540` base caused linearization conflicts. The older PoC vault keeps the `AccessControl` role model for comparison.

## Final review wording

Use this wording in review or presentation:

```text
OmniETF is an ETF-like cross-chain basket share PoC.
It proves that Base can keep one canonical mETF supply and NAV while CCTP moves USDC to Solana, Solana holds visible mock basket custody, and a reporter finalizes executed value back into Base before shares are minted.
```
