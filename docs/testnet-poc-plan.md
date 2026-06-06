# Base Sepolia ↔ Solana Devnet Testnet PoC Plan

## Goal

Run the existing OmniETF EVM↔SVM proof-of-concept on public testnets:

- EVM side: Base Sepolia (`chainId=84532`)
- SVM side: Solana Devnet
- Bridge visibility:
  1. OmniETF application flow uses the existing trusted relayer adapter, but against public testnet transactions.
  2. Chainlink CCIP Base Sepolia → Solana Devnet lane is checked separately and can be exercised with a token-only transfer for a real CCIP Explorer-verifiable bridge transaction.

This split is intentional for the current repository state: `LocalSvmBridgeAdapter` and `omnietf-portfolio` already prove OmniETF accounting and Solana state mutation, while a production-grade CCIP receiver would require implementing Chainlink's SVM `ccip_receive` interface and security validation around allowed offramp PDAs.

## Current Chainlink facts verified 2026-06-03

Official Chainlink CCIP directory values:

| Item | Value |
| --- | --- |
| Base Sepolia router | `0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93` |
| Base Sepolia selector | `10344971235874465080` |
| Base Sepolia LINK fee token | `0xE4aB69C077896252FAFBD49EFD26B5D171A32410` |
| Solana Devnet router program | `Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C` |
| Solana Devnet selector | `16423721717087811551` |
| Solana Devnet fee quoter | `FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi` |

Use `npm run ccip:base-solana:check` before any live CCIP send; it calls the Base Sepolia router and prints the currently supported token addresses for the Solana Devnet lane.

## Required local tools

```bash
node --version       # Node 20+ recommended for Chainlink tools
forge --version
cargo-build-sbf --version
solana --version
```

## Required funding/secrets

Set these in your shell; do not commit generated deployment files or keypairs.

```bash
export BASE_SEPOLIA_RPC_URL="https://..."
export RPC_URL="$BASE_SEPOLIA_RPC_URL"
export DEPLOYER_PRIVATE_KEY="0x..."     # funded with Base Sepolia ETH
export SOLANA_RPC_URL="https://api.devnet.solana.com"
# optional: point at a pre-funded Solana devnet keypair
export SOLANA_PAYER_KEYPAIR="$HOME/.config/solana/id.json"
```

Funding checklist:

- Base Sepolia ETH for contract deploys and EVM transactions.
- Solana Devnet SOL for program deploy and state transactions.
- Optional CCIP lane test: a Base Sepolia token supported by `getSupportedTokens(Solana Devnet selector)` plus ETH for native CCIP fees.

## Phase 1 — Verify support and build locally

```bash
npm install
npm run ccip:base-solana:check
npm run test:contracts
npm run build:contracts
npm run build:svm
```

Expected: CCIP check returns `supportsSolana: true`; contract and SVM builds pass.

## Phase 2 — Deploy SVM program to Solana Devnet

```bash
npm run deploy:solana-devnet
```

Outputs:

- `deployments/svm-devnet.json`
- Solana Explorer-checkable program id and state address

If devnet airdrop is rate-limited, fund the printed payer address manually or set `SOLANA_PAYER_KEYPAIR` to a funded keypair and rerun.

## Phase 3 — Deploy EVM OmniETF contracts to Base Sepolia

```bash
npm run deploy:base-sepolia
```

Outputs:

- `deployments/base-sepolia.json`
- `OmniETFManager`, `OmniETFShare`, `MockUSDC`, `LocalSvmBridgeAdapter` addresses on Base Sepolia

The script refuses to use the public Anvil private key on non-local chains and does not write private keys into public-testnet deployment JSON.

## Phase 4 — Run OmniETF public-testnet flow

Use `cast` or a small script to call the manager on Base Sepolia:

```bash
MANAGER=$(jq -r '.contracts.OmniETFManager' deployments/base-sepolia.json)
MOCK_USDC=$(jq -r '.contracts.MockUSDC' deployments/base-sepolia.json)

cast send "$MOCK_USDC" "approve(address,uint256)" "$MANAGER" 100000000 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"

DEPOSIT_ID=$(cast call "$MANAGER" "nextRequestId()(uint256)" --rpc-url "$BASE_SEPOLIA_RPC_URL")
cast send "$MANAGER" "requestDeposit(uint256)" 100000000 \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"

npm run relay:testnet:once allocation "$DEPOSIT_ID"
```

The relay result includes both:

- `svmTx`: Solana Devnet transaction mutating the portfolio state.
- `evmTx`: Base Sepolia transaction acknowledging the snapshot and minting mETF.

Repeat with `requestRebalance`/`relay:testnet:once rebalance <id>` and `requestRedeem`/`relay:testnet:once redeem <id>` to cover the full lifecycle.

## Phase 5 — Optional real CCIP bridge transaction

First list supported token addresses:

```bash
npm run ccip:base-solana:check
```

Then bridge a supported token from Base Sepolia to a Solana Devnet wallet:

```bash
export SOLANA_RECIPIENT="<solana-devnet-wallet>"
export CCIP_TOKEN_ADDRESS="0x..."      # must be one of supportedTokens from the check script
export CCIP_TOKEN_AMOUNT="1"
export CCIP_TOKEN_DECIMALS="18"        # set to the token decimals
npm run ccip:base-solana:token
```

The script pays CCIP fees with native ETH, approves the token to the CCIP router, calls `ccipSend`, and prints the Base Sepolia transaction hash for CCIP Explorer tracking.

## Acceptance criteria

- `npm run ccip:base-solana:check` reports Base Sepolia router support for Solana Devnet.
- `deployments/svm-devnet.json` contains a Solana Devnet executable program id and initialized state account.
- `deployments/base-sepolia.json` contains Base Sepolia OmniETF contract addresses.
- Deposit relay produces one Solana Devnet tx and one Base Sepolia ack tx.
- Optional CCIP token transfer produces a Base Sepolia `ccipSend` tx that appears in CCIP Explorer.

## Risks and next step to full CCIP-native OmniETF

- Current OmniETF application bridge is trusted-relayer based. It is suitable for transaction-visible PoC, not production.
- Full CCIP-native OmniETF requires replacing `LocalSvmBridgeAdapter` with a CCIP sender/receiver pair and updating the SVM program to implement Chainlink's `ccip_receive` instruction, including the required first three receiver accounts and allowed-offramp validation.
- Programmable token transfer with USDC EVM→Solana has Chainlink-documented heap-limit caveats; for PoC, prefer arbitrary messaging or token-only CCIP checks before integrating portfolio accounting.
