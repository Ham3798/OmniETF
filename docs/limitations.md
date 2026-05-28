# OmniETF PoC Limitations

## What this PoC proves

- Async cross-chain ETF accounting lifecycle can be modeled with request ids and settlement acknowledgements.
- Base/EVM-side share supply can track an acknowledged remote reserve snapshot.
- Deposit, redeem, NAV, and rebalance flows can be tested deterministically.
- The local EVM↔SVM path can execute against `solana-test-validator` program state through a trusted relayer.

## What this PoC does not prove

- It does not prove production bridge security.
- It does not verify Solana state proofs on EVM.
- It does not bridge real USDC between chains.
- It does not call Jupiter or use real tokenized stock liquidity.
- It does not provide production oracle security.
- It is not a regulatory or investment product implementation.
- It is not a full ERC-4626 compliance target because settlement is asynchronous.

## Mock / local boundaries

| Component | Boundary |
| --- | --- |
| `MockBridgeAdapter` | Replaces CCIP/Wormhole/LayerZero message delivery in EVM-only tests. |
| `MockSolanaPortfolio` | Replaces Solana executor/PDA treasury in EVM-only tests. |
| `LocalSvmBridgeAdapter` | Accepts trusted local relayer acks; not a verified bridge receiver. |
| `scripts/relayer-local.ts` | Trusted local bridge simulator between Anvil and solana-test-validator. |
| `omnietf-portfolio` SVM program | Synthetic accounting ledger, not real tokenized stock custody or swaps. |
| `MockPriceOracle` | Replaces live price feeds/quotes. |
| `MockUSDC` | Replaces real USDC on Base/testnet. |

## Follow-up paths

1. Replace trusted relayer snapshots with Wormhole/CCIP verified message delivery.
2. Add real SVM token accounts and SPL/Token-2022 mint/burn semantics.
3. Add Jupiter quote/swap integration on SVM.
4. Replace mock oracle inputs with production-grade pricing and validation.
5. Add browser E2E click automation for the full visual lifecycle.

## Frontend-specific limitations

- The frontend uses a deterministic Anvil private key for a no-wallet presentation flow.
- It is not a production wallet UX.
- In SVM mode, the browser calls the local relayer HTTP API at `http://127.0.0.1:8787`.
- It requires deployment artifacts generated against the currently running Anvil and solana-test-validator instances.
