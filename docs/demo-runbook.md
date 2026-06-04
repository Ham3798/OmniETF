# OmniETF Demo Runbook

## Demo claim

The demo proves a narrow end-to-end path:

```text
Base USDC deposit
-> CCTP settlement to Solana devnet
-> mock xStock basket custody on Solana
-> reporter finalization on Base
-> mETF claim through ERC-7540 deposit
-> redeem claim and Base-side USDC payout
```

It does not claim a production ETF, issuer-backed xStock trading, permissionless oracle reporting, or automated issuer-backed asset liquidation.

## Pre-demo sanity check

Run this before presenting:

```bash
npm run review:check
```

Expected result:

```text
forge fmt --check: passed
forge test: all tests passed
portfolio self-test passed
```

## Narrative order

1. Open `slides.md` or `OmniETF.pptx`.
2. State the definition:

```text
OmniETF is an ETF-like cross-chain basket share PoC, not a legal ETF.
```

3. Show the architecture slide:

```text
Base manager owns canonical mETF supply and NAV.
Solana holds visible mock reserve custody.
CCTP moves USDC settlement capital.
Reporter brings the Solana execution value back to Base.
```

4. Emphasize the invariant:

```text
one supply
one value
one async lifecycle
```

## Verified on-chain evidence

These are already recorded in `docs/cctp-router.md`.

### CCTP-only transfer

```text
Base Sepolia deposit tx:
0x1c27a3699f40ad9bb302faf894a81730a65a5a6a14ea69a10f73cc6f7d829b19

Solana receiveMessage tx:
35KSdq7q5wvdDDszTQvDc2pA9K2Dh4dq5v1a7UxPbwrq3awKBmDiDG1mkVvAxPjRh3C4rx1jzv9nXfRHF3bGLVo1

Received:
0.99987 devnet USDC
```

### Async vault run

```text
OmniETFAsyncVault:
0x17fA3a0584Fa5FE9EC535905b12929FDa5dB927f

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

### Official OpenZeppelin ERC-7540 vault run

Contracts:

```text
OmniETFOZAsyncVault:
0x0f10b6D2380bea84b67eB4Eeb36E1F095b69c06C
https://sepolia.basescan.org/address/0x0f10b6D2380bea84b67eB4Eeb36E1F095b69c06C

AccessManager:
0x4791b239A404A4786B9D55440470Da55ccA41d88
https://sepolia.basescan.org/address/0x4791b239A404A4786B9D55440470Da55ccA41d88
```

Code locations:

```text
contracts/OmniETFOZAsyncVault.sol
script/DeployOmniETFOZAsyncVault.s.sol
script/RequestOmniETFDeposit.s.sol
script/FinalizeOmniETFDeposit.s.sol
script/RequestOmniETFRedeem.s.sol
script/MarkOmniETFRedeemClaimable.s.sol
script/FundOmniETFRedeemPayout.s.sol
script/ClaimOmniETFRedeem.s.sol
scripts/burn-cctp-solana.mjs
scripts/receive-cctp-evm.mjs
scripts/receive-cctp-solana.mjs
```

Deploy and role setup:

```text
AccessManager deploy:
0xa62eb2c039ede41d1997a9b91fb47977dc90eb79cb311267fc0c044cf2eec36b
https://sepolia.basescan.org/tx/0xa62eb2c039ede41d1997a9b91fb47977dc90eb79cb311267fc0c044cf2eec36b

OmniETFOZAsyncVault deploy:
0x3bd957fcb5724db6e3dce6d8b16316aae68e9b817145f50325169ab13ce9613d
https://sepolia.basescan.org/tx/0x3bd957fcb5724db6e3dce6d8b16316aae68e9b817145f50325169ab13ce9613d

Reporter role grant:
0x0167141c637b162b90c6742ed7d0c5aff4bf3389dbe8a59d8c27bc21be169e3c
https://sepolia.basescan.org/tx/0x0167141c637b162b90c6742ed7d0c5aff4bf3389dbe8a59d8c27bc21be169e3c

Pauser role grant:
0xeebc18cf62630396887a7dbc5f9e682771dac7acfb6ea5793fa16b0a0e664ddd
https://sepolia.basescan.org/tx/0xeebc18cf62630396887a7dbc5f9e682771dac7acfb6ea5793fa16b0a0e664ddd

Reporter function role binding:
0xdf331764468d495f9a5cef861f19c17a470ec4fa94d2fb7173b96c23e2ec831f
https://sepolia.basescan.org/tx/0xdf331764468d495f9a5cef861f19c17a470ec4fa94d2fb7173b96c23e2ec831f

Pauser function role binding:
0xf4bb19249eb3cbb24c49a0799d3101da4c9f512fa5c567fbecafd37ea48623d7
https://sepolia.basescan.org/tx/0xf4bb19249eb3cbb24c49a0799d3101da4c9f512fa5c567fbecafd37ea48623d7
```

Deposit path:

```text
setDepositRoute:
0x10cb6577dc0acc9c0297506f72aa012292fbc81c543e575569b3da2b5c772645
https://sepolia.basescan.org/tx/0x10cb6577dc0acc9c0297506f72aa012292fbc81c543e575569b3da2b5c772645

USDC approve:
0xf59b71b14d3bfa87c77076e74fabbb653059eee05632ceb0f4c60aa39072cec2
https://sepolia.basescan.org/tx/0xf59b71b14d3bfa87c77076e74fabbb653059eee05632ceb0f4c60aa39072cec2

requestDeposit:
0x4e949164fdd4a0c76152eac7a5ed211fe13af278b509f12cd017747bf2ce2bc8
https://sepolia.basescan.org/tx/0x4e949164fdd4a0c76152eac7a5ed211fe13af278b509f12cd017747bf2ce2bc8

Solana receiveMessage:
3MKyDpvixWoryeeWBN6H7RTnfKSfSZ7sEkD6eDtgiL3QVQfrTakZjPVh11eNYJS72FgLSKNLXJrX88rR6zWXy9iS
https://explorer.solana.com/tx/3MKyDpvixWoryeeWBN6H7RTnfKSfSZ7sEkD6eDtgiL3QVQfrTakZjPVh11eNYJS72FgLSKNLXJrX88rR6zWXy9iS?cluster=devnet

finalizeDeposit:
0x2fc3670aa05799bee978d1e9819c8aa81bb7bc41bae9ec10c636c8fa0d7ffa80
https://sepolia.basescan.org/tx/0x2fc3670aa05799bee978d1e9819c8aa81bb7bc41bae9ec10c636c8fa0d7ffa80

Base result after deposit:
totalSupply = 999870
user mETF balance = 999870
totalAssets = 999870
```

Redeem path A, reverse CCTP direct vault funding:

```text
requestRedeem 500000 shares:
0x6e87a6165e0e6e58a7e40eac05df1f4a222e92825b03e6d1e2bf8302772c37f7
https://sepolia.basescan.org/tx/0x6e87a6165e0e6e58a7e40eac05df1f4a222e92825b03e6d1e2bf8302772c37f7

Solana burn:
2Ze5UZhNbhAB2qm4GnNa7gSb4t4wEJH7XkHy2RfYhqgi2JRAgYRkhFRGgMAb8tVcG3dv1mmY5uXN3fkG1gPcpn8V
https://explorer.solana.com/tx/2Ze5UZhNbhAB2qm4GnNa7gSb4t4wEJH7XkHy2RfYhqgi2JRAgYRkhFRGgMAb8tVcG3dv1mmY5uXN3fkG1gPcpn8V?cluster=devnet

Base receiveMessage:
0x80efafa43f05a293ccc48667bc600be0044afbab44a1752de151732c1db8f945
https://sepolia.basescan.org/tx/0x80efafa43f05a293ccc48667bc600be0044afbab44a1752de151732c1db8f945

markRedeemClaimable:
0x0280fdc8434d0a3b5969775a449cc7f3edcc2fbd8c7e1565fc8b5d5872de4619
https://sepolia.basescan.org/tx/0x0280fdc8434d0a3b5969775a449cc7f3edcc2fbd8c7e1565fc8b5d5872de4619

claimRedeem:
0x60b179b73a94f6f109b8ca016fb03ad2564bf154992a7f58aea1aba2d8e94211
https://sepolia.basescan.org/tx/0x60b179b73a94f6f109b8ca016fb03ad2564bf154992a7f58aea1aba2d8e94211
```

Redeem path B, reporter-funded payout:

```text
requestRedeem 100000 shares:
0x0c102a08fb6dd49d00ff03c16d8d7ecf268db7929a5d6643ea6584fae57c01a7
https://sepolia.basescan.org/tx/0x0c102a08fb6dd49d00ff03c16d8d7ecf268db7929a5d6643ea6584fae57c01a7

USDC approve:
0x08f304aeb340cb3abd0362bca116b75533e3bf80ca69834ea86ce9f8db05098d
https://sepolia.basescan.org/tx/0x08f304aeb340cb3abd0362bca116b75533e3bf80ca69834ea86ce9f8db05098d

fundRedeemPayout:
0x74368d58c05819e23a8904e5229007177766cb3c3adce46149434fab3c69ea8c
https://sepolia.basescan.org/tx/0x74368d58c05819e23a8904e5229007177766cb3c3adce46149434fab3c69ea8c

claimRedeem:
0xf36ed0bca53bf1e41589f038ae9e59024e57e8b7ad426b2db87540c585d0536d
https://sepolia.basescan.org/tx/0xf36ed0bca53bf1e41589f038ae9e59024e57e8b7ad426b2db87540c585d0536d
```

Final Base state after both redeem scenarios:

```text
totalSupply = 399870
user mETF balance = 399870
totalAssets = 399870
vault USDC = 0
redeem request 1 pending = 0
redeem request 1 claimable = 0
redeem request 2 pending = 0
redeem request 2 claimable = 0
```

## Live command sequence

Use this only if testnet keys and devnet SOL/USDC setup are ready.

### 1. Request Base deposit

```bash
forge script script/RequestOmniETFDeposit.s.sol:RequestOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

Expected point to mention:

```text
mETF is not minted yet.
The vault records a Pending ERC-7540 deposit request and starts CCTP settlement.
```

### 2. Receive CCTP on Solana

```bash
npm run cctp:status -- "$CCTP_SOURCE_TX"
npm run cctp:receive-solana
```

Expected point to mention:

```text
Solana receives devnet USDC in the target SPL token account.
```

### 3. Allocate mock xStock basket

```bash
npm run portfolio:allocate
npm run xstock:allocate
npm run xstock:balances
npm run portfolio:nav
npm run portfolio:settle-redeem -- --shares "$REDEEM_SHARES_DECIMAL"
npm run portfolio:execute-redeem -- --shares "$REDEEM_SHARES_DECIMAL"
npm run cctp:burn-solana
npm run cctp:receive-evm
```

Expected point to mention:

```text
The basket is fixed weight:
AAPLx 40%, TSLAx 30%, NVDAx 30%.
The redeem execution step subtracts the mock sale from the ledger, burns Solana USDC through CCTP, and mints Base USDC to the vault after attestation.
```

### 4. Mark claimable and claim Base mETF

```bash
npm run vault:demo

forge script script/FinalizeOmniETFDeposit.s.sol:FinalizeOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

export CLAIM_ASSETS=999870
forge script script/ClaimOmniETFDeposit.s.sol:ClaimOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

Expected point to mention:

```text
The standard ERC-7540 deposit claim mints mETF from executed Solana value using NAV before claim.
```

### 5. Show redeem lifecycle

```bash
forge script script/RequestOmniETFRedeem.s.sol:RequestOmniETFRedeem \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/FundOmniETFRedeemPayout.s.sol:FundOmniETFRedeemPayout \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

# After reverse CCTP mints USDC directly into the vault:
forge script script/MarkOmniETFRedeemClaimable.s.sol:MarkOmniETFRedeemClaimable \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/ClaimOmniETFRedeem.s.sol:ClaimOmniETFRedeem \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

Expected point to mention:

```text
Redeem escrows shares at request time. The mock settlement execution gives the reporter `REDEEM_ASSETS_CLAIMABLE`; reverse CCTP can mint USDC directly to the vault, then the reporter marks the request claimable. The vault reserves that USDC, then the user burns escrowed shares and receives Base USDC.
```

## Offline fallback

If testnet state, RPC, faucet, or Circle attestation is slow, run:

```bash
npm run review:check
npm run portfolio:test
```

Then show:

- `docs/cctp-router.md` verified transaction section
- `contracts/OmniETFAsyncVault.sol` deposit and redeem state machines
- `scripts/portfolio-core.mjs` basket and NAV math

## Q&A guardrails

- Is this a real ETF?
  - No. It is an ETF-like basket share PoC.
- Is CCIP used?
  - Yes, but not for USDC settlement. Current USDC execution uses CCTP. CCIP is verified as Base/Solana control messaging plus CCIP-BnM test token round trip.
- Are xStocks real issuer-backed assets?
  - No. They are devnet mock SPL tokens.
- Does redeem pay USDC back today?
  - Yes on the Base vault path once USDC is funded into the vault. The contract rejects claimable transitions that are not backed by unreserved vault USDC. The mock sale, Solana CCTP burn script, EVM receive script, and Base claim path are present; issuer-backed xStock sale is future work.
- What is actually proven?
  - The system avoids minting before cross-chain execution finality and mints canonical Base mETF from reported executed value.
