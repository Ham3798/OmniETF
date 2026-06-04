# CCTP Deposit Router

This repo does not redeploy Circle CCTP. It adds a thin OmniETF-facing wrapper that calls Circle's deployed `TokenMessengerV2`.

## Contract

- `contracts/CctpDepositRouter.sol`
- `contracts/OmniETFAsyncVault.sol`

Flow:

```text
user
  -> approve(router, amount)
  -> router.deposit(amount, mintRecipient, maxFee)
      -> USDC.transferFrom(user, router, amount)
      -> USDC.approve(TokenMessengerV2, amount)
      -> TokenMessengerV2.depositForBurn(...)
      -> emit DepositStarted(...)
```

The destination-side `receiveMessage(message, attestation)` call is submitted to Circle's deployed `MessageTransmitterV2` on the destination chain/program. On Solana this is not a simple EVM call; it is an Anchor instruction with the TokenMessengerMinter remaining accounts.

## Token standard model

OmniETF uses token standards as design anchors, not as a claim that one existing standard fully solves cross-chain basket accounting.

| Standard | PoC role |
| --- | --- |
| ERC-20 | OpenZeppelin `mETF` canonical share token on Base |
| ERC-4626 | NAV/share math reference: assets convert to shares by current vault value |
| ERC-7540 | Async request/claim lifecycle, request IDs, operator approval, pending/claimable request views |
| ERC-7575 | Vault/share interface surface for asset, share, deposit, mint, withdraw, and redeem |
| ERC-7621 | Basket weights and rebalance vocabulary |
| SPL Token | Solana reserve asset custody for mock xStocks |
| CCTP | USDC settlement rail from Base to Solana |

The key timing rule is:

```text
requestDeposit starts CCTP, but does not mint mETF.
Pending -> Settled -> Claimable -> Claimed
deposit/mint claims mETF only after Solana execution value is known.
```

This avoids minting against a pre-execution estimate that ignores CCTP fees, execution slippage, or failed settlement.

The vault implements the ERC-7540 / ERC-7575 interface surface used by this PoC. It exposes request IDs, `setOperator` / `isOperator`, standard pending/claimable request views, and standard claim functions:

```text
requestDeposit(assets, controller, owner)
pendingDepositRequest(requestId, controller)
claimableDepositRequest(requestId, controller)
deposit(assets, receiver, controller)
mint(shares, receiver, controller)
requestRedeem(shares, controller, owner)
pendingRedeemRequest(requestId, controller)
claimableRedeemRequest(requestId, controller)
withdraw(assets, receiver, controller)
redeem(shares, receiver, controller)
```

Because CCTP also needs a Solana USDC token account and max fee, the controller first calls `setDepositRoute(mintRecipient, maxFee)`.

## Test

```bash
forge test
```

## Deploy

Copy `.env.example` to `.env` and fill current Circle CCTP V2 addresses from Circle docs.

```bash
source .env

forge script script/DeployCctpDepositRouter.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

## Start a deposit

```bash
source .env
export CCTP_DEPOSIT_ROUTER=0x...

forge script script/StartCctpDeposit.s.sol \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

## Async vault request and claim

Deploy the async vault:

```bash
forge script script/DeployOmniETFAsyncVault.s.sol:DeployOmniETFAsyncVault \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

# Standards-aligned target: official OpenZeppelin Community ERC7540 base + AccessManager.
forge script script/DeployOmniETFOZAsyncVault.s.sol:DeployOmniETFOZAsyncVault \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

Request a deposit. This sends USDC through CCTP and records a pending deposit, but `mETF` total supply remains unchanged.

```bash
forge script script/RequestOmniETFDeposit.s.sol:RequestOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

After Solana receives USDC and the mock xStock basket is allocated, the reporter marks the request settled/executed. The user then claims with standard `deposit`.

```bash
forge script script/FinalizeOmniETFDeposit.s.sol:FinalizeOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

export CLAIM_ASSETS=999870
forge script script/ClaimOmniETFDeposit.s.sol:ClaimOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

`finalizeDeposit(depositId, executedValue)` remains as a reporter shortcut for demos, but the standard ERC-7540 path is `markDepositSettled`, `markDepositExecuted`, then user/operator `deposit` or `mint`.

For the first deposit, `999870` executed base units mint `0.99987 mETF`. For later deposits, shares are minted with:

```text
shares = executedValue * totalSupplyBefore / totalManagedAssetsBefore
```

## Async vault redeem lifecycle

The Base vault also exposes the reviewable redeem side of the async lifecycle:

```text
requestRedeem(shares, controller, owner) -> fundRedeemPayout(redeemId, assets) -> redeem(shares, receiver, controller)
requestRedeem(shares, controller, owner) -> reverse CCTP mint to vault -> markRedeemClaimable(redeemId, assets) -> redeem(shares, receiver, controller)
```

Run:

```bash
forge script script/RequestOmniETFRedeem.s.sol:RequestOmniETFRedeem \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/FundOmniETFRedeemPayout.s.sol:FundOmniETFRedeemPayout \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/MarkOmniETFRedeemClaimable.s.sol:MarkOmniETFRedeemClaimable \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/ClaimOmniETFRedeem.s.sol:ClaimOmniETFRedeem \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

`requestRedeem` moves mETF into vault escrow and records the request. `fundRedeemPayout` is reporter-only; it pulls USDC into the vault and marks the request claimable after the reverse settlement leg is available. If reverse CCTP mints directly to the vault, `markRedeemClaimable` uses the vault's unreserved USDC balance instead. `reservedRedeemAssets` prevents the same vault balance from backing two redeem requests. `redeem` / `withdraw` burns escrowed shares and transfers reserved USDC from the vault to the receiver. In production the funding USDC would come from Solana -> Base CCTP after selling reserve assets; in tests the reporter-funded and direct-vault-funded paths prove the Base-side payout behavior.

## What to verify

1. Router emits `DepositStarted`.
2. Circle `TokenMessengerV2` emits `DepositForBurn`.
3. Circle `MessageTransmitterV2` emits `MessageSent`.
4. Use the emitted `message` to request Circle attestation.
5. Submit `receiveMessage(message, attestation)` on the destination chain/program.
6. Vault emits ERC-7540 `DepositRequest`, then `DepositSettled`, `DepositExecuted`, and ERC-7575 `Deposit`.
7. Vault emits ERC-7540 `RedeemRequest`, then `RedeemClaimable`, and ERC-7575 `Withdraw`.

## Current Base Sepolia values

Circle CCTP V2 Base Sepolia:

```text
BASE_SEPOLIA_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
BASE_SEPOLIA_TOKEN_MESSENGER_V2=0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
BASE_SEPOLIA_MESSAGE_TRANSMITTER_V2=0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
BASE_SEPOLIA_TOKEN_MINTER_V2=0xb43db544E2c27092c107639Ad201b3dEfAbcF192
```

Only `BASE_SEPOLIA_USDC` and `BASE_SEPOLIA_TOKEN_MESSENGER_V2` are required by the current router.

Still user-specific:

```text
PRIVATE_KEY
MINT_RECIPIENT_BYTES32
```

For Solana, `MINT_RECIPIENT_BYTES32` must be the 32-byte USDC token account encoded as hex. Do not use a wallet/system account. Circle's Solana receiver validates that the token account already exists and matches the `mintRecipient` in the burn message.

Create the Solana devnet USDC associated token account for an owner:

```bash
spl-token create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
  --owner <SOLANA_OWNER_PUBKEY> \
  --fee-payer <FUNDED_SOLANA_KEYPAIR> \
  --url https://api.devnet.solana.com
```

Convert that token account public key to the required bytes32 hex:

```bash
node scripts/solana-address-to-bytes32.mjs <SOLANA_USDC_TOKEN_ACCOUNT>
```

Then set:

```bash
MINT_RECIPIENT_BYTES32=0x...
```

After the Base burn is attested by Circle, submit the Solana receive transaction:

```bash
npm run cctp:status -- <BASE_DEPOSIT_TX>
npm run cctp:receive-solana
```

## ETF mock portfolio demo

After Solana receives devnet USDC, the ETF portfolio leg is modeled as a local JSON ledger. This keeps the PoC reproducible on devnet while avoiding mainnet xStock/Jupiter execution risk.

The mock share rule is:

```text
1 received USDC = 1 OmniETF share
```

The default mock xStock basket is:

| Asset | Weight | Mock price |
| --- | ---: | ---: |
| AAPLx | 40% | $200 |
| TSLAx | 30% | $350 |
| NVDAx | 30% | $1000 |

Run:

```bash
npm run portfolio:allocate
npm run xstock:allocate
npm run xstock:balances
npm run portfolio:nav
npm run portfolio:redeem -- --shares 0.5
```

Or run the status + portfolio demo in one command:

```bash
npm run demo:e2e
```

`portfolio:allocate` reads `SOLANA_USDC_TOKEN_ACCOUNT` from `.env`. If it is not set, it derives the token account from `MINT_RECIPIENT_BYTES32`.

The generated ledger is written to:

```text
.omnietf/portfolio-ledger.json
```

This file is intentionally ignored by git because it is local demo state.

The CLI portfolio redeem can run in two modes. Quote mode shows the asset sales and reporter funding amount without mutating the ledger. Execute mode mutates the mock ledger as if the Solana basket was sold, records the reverse CCTP burn parameters, and points the operator to the Base claimable transition after USDC reaches the vault. The Base vault separately executes the redeem lifecycle through `Pending -> Claimable -> Claimed` and transfers Base-side USDC when the vault is funded. A production redeem flow must replace the mock sale with a real issuer-backed asset sale; the Solana -> Base CCTP burn and EVM receive scripts are present for live testnet runs.

For the mock demo, generate the reporter funding amount from the portfolio ledger:

```bash
npm run portfolio:settle-redeem -- --shares 0.5
npm run portfolio:execute-redeem -- --shares 0.5
npm run cctp:burn-solana
npm run cctp:receive-evm
```

`portfolio:settle-redeem` writes `.omnietf/redeem-settlement.json` with `REDEEM_ASSETS_CLAIMABLE` and the next `FundOmniETFRedeemPayout` command. `portfolio:execute-redeem` additionally updates `.omnietf/portfolio-ledger.json`, records `reverseCctpBurnIntent`, and emits a command chain for the direct-vault-funding path: `cctp:burn-solana`, `cctp:receive-evm`, then `MarkOmniETFRedeemClaimable`.

`xstock:allocate` creates devnet mock SPL mints for `AAPLx`, `TSLAx`, and `NVDAx`, then mints the target quantities to a treasury token account. These are not issuer-backed xStock assets; they are devnet mock tokens used to make the execution leg visible on-chain.

The script accepts either:

```text
SOLANA_PRIVATE_KEY=[...]
```

or:

```text
SOLANA_KEYPAIR_PATH=/absolute/path/to/solana-keypair.json
```

## Verified devnet transfer

This PoC has completed a Base Sepolia -> Solana devnet CCTP V2 transfer.

```text
Base Sepolia deposit tx:
0x1c27a3699f40ad9bb302faf894a81730a65a5a6a14ea69a10f73cc6f7d829b19

Solana receiveMessage tx:
35KSdq7q5wvdDDszTQvDc2pA9K2Dh4dq5v1a7UxPbwrq3awKBmDiDG1mkVvAxPjRh3C4rx1jzv9nXfRHF3bGLVo1

Solana recipient token account:
9y7ns4FyHSFscz5yvgAfchDVzr9VUsyDSx56VttABut

Received:
0.99987 devnet USDC
```

With that balance, the mock portfolio ledger produces:

```text
total shares: 0.99987
NAV: 1
AAPLx: 40%
TSLAx: 30%
NVDAx: 30%
```

## Verified async vault testnet run

The ERC-7540-style vault path has also been exercised on Base Sepolia with real CCTP settlement to Solana devnet and reporter finalization back on Base.

```text
OmniETFAsyncVault:
0x17fA3a0584Fa5FE9EC535905b12929FDa5dB927f

Deploy tx:
0x1ccf387d967e33ccaedfc4f38551bce12afdfcd9965177f78a9b3732f38c0737

requestDeposit tx:
0x84bcba283e8cd2207e2a4d2cc853d3c4c0cae0f7a53656b192e1c989f063d127

depositId:
0x0f45fd5750cb25b9efab38f04d9ea1824825c23bcaa06f3a19d5131b1d4933c7

Solana receiveMessage tx:
4iKs3KxC8c15AR1vyATzP7URo3YVPwPLmgnaDBt5VrsvGf8oS1MjjFssh4ni4NC6K4hky6N6r86xf3vEfATHB7Ty

finalizeDeposit tx:
0xf893c5162a64af544642b3d158a5fca1eb82175a4de867e8f302ccb7a853c827

Base result:
totalSupply = 999870
user mETF balance = 999870
totalManagedAssets = 999870
NAV = 1000000
```
