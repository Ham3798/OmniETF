# Full Lifecycle On-Chain E2E Evidence

## Status

This repository has an on-chain, end-to-end demo for the full async lifecycle:

```text
Base deposit request
-> CCTP USDC settlement to Solana devnet
-> mock xStock reserve/custody accounting on Solana
-> Base reporter finalization
-> mETF share claim
-> Base redeem request
-> Solana reverse CCTP settlement
-> Base redeem claim
```

It also has a separate Chainlink CCIP control-plane path:

```text
Base sender contract
-> CCIP Base Sepolia to Solana Devnet
-> Solana custody receiver program records allocation units
```

The demo does not prove a legal ETF, real issuer-backed xStock execution, Jupiter routing, or automated liquidation. The Solana basket is a devnet/mock SPL-token reserve surface used to prove custody/accounting and cross-chain operation shape.

## Core Contracts And Programs

| Surface | Address | Code |
| --- | --- | --- |
| Base Sepolia OZ ERC-7540 async vault | `0x0f10b6D2380bea84b67eB4Eeb36E1F095b69c06C` | `contracts/OmniETFOZAsyncVault.sol` |
| Base Sepolia AccessManager | `0x4791b239A404A4786B9D55440470Da55ccA41d88` | `script/DeployOmniETFOZAsyncVault.s.sol` |
| Base Sepolia CCIP sender | `0xD340cECB276600082546e7F161c1D577767BA89f` | `contracts/OmniETFCCIPSender.sol` |
| Solana devnet CCIP custody receiver | `4LaatT5FGgWMkFfT3zLUSEnsaWegk52a2nEwk8VRR881` | `solana/omnietf-custody/programs/omnietf-custody/src/lib.rs` |

## Base Full Lifecycle Evidence

All Base Sepolia transaction receipts below were rechecked with `cast receipt` and returned `status=1 (success)`.

| Step | Tx | URL |
| --- | --- | --- |
| Deploy `OmniETFOZAsyncVault` | `0x3bd957fcb5724db6e3dce6d8b16316aae68e9b817145f50325169ab13ce9613d` | https://sepolia.basescan.org/tx/0x3bd957fcb5724db6e3dce6d8b16316aae68e9b817145f50325169ab13ce9613d |
| Set deposit route | `0x10cb6577dc0acc9c0297506f72aa012292fbc81c543e575569b3da2b5c772645` | https://sepolia.basescan.org/tx/0x10cb6577dc0acc9c0297506f72aa012292fbc81c543e575569b3da2b5c772645 |
| Approve USDC | `0xf59b71b14d3bfa87c77076e74fabbb653059eee05632ceb0f4c60aa39072cec2` | https://sepolia.basescan.org/tx/0xf59b71b14d3bfa87c77076e74fabbb653059eee05632ceb0f4c60aa39072cec2 |
| Request deposit | `0x4e949164fdd4a0c76152eac7a5ed211fe13af278b509f12cd017747bf2ce2bc8` | https://sepolia.basescan.org/tx/0x4e949164fdd4a0c76152eac7a5ed211fe13af278b509f12cd017747bf2ce2bc8 |
| Finalize deposit / make claimable | `0x2fc3670aa05799bee978d1e9819c8aa81bb7bc41bae9ec10c636c8fa0d7ffa80` | https://sepolia.basescan.org/tx/0x2fc3670aa05799bee978d1e9819c8aa81bb7bc41bae9ec10c636c8fa0d7ffa80 |
| Request redeem, path A | `0x6e87a6165e0e6e58a7e40eac05df1f4a222e92825b03e6d1e2bf8302772c37f7` | https://sepolia.basescan.org/tx/0x6e87a6165e0e6e58a7e40eac05df1f4a222e92825b03e6d1e2bf8302772c37f7 |
| Receive reverse CCTP on Base | `0x80efafa43f05a293ccc48667bc600be0044afbab44a1752de151732c1db8f945` | https://sepolia.basescan.org/tx/0x80efafa43f05a293ccc48667bc600be0044afbab44a1752de151732c1db8f945 |
| Mark redeem claimable, path A | `0x0280fdc8434d0a3b5969775a449cc7f3edcc2fbd8c7e1565fc8b5d5872de4619` | https://sepolia.basescan.org/tx/0x0280fdc8434d0a3b5969775a449cc7f3edcc2fbd8c7e1565fc8b5d5872de4619 |
| Claim redeem, path A | `0x60b179b73a94f6f109b8ca016fb03ad2564bf154992a7f58aea1aba2d8e94211` | https://sepolia.basescan.org/tx/0x60b179b73a94f6f109b8ca016fb03ad2564bf154992a7f58aea1aba2d8e94211 |
| Request redeem, path B | `0x0c102a08fb6dd49d00ff03c16d8d7ecf268db7929a5d6643ea6584fae57c01a7` | https://sepolia.basescan.org/tx/0x0c102a08fb6dd49d00ff03c16d8d7ecf268db7929a5d6643ea6584fae57c01a7 |
| Fund redeem payout, path B | `0x74368d58c05819e23a8904e5229007177766cb3c3adce46149434fab3c69ea8c` | https://sepolia.basescan.org/tx/0x74368d58c05819e23a8904e5229007177766cb3c3adce46149434fab3c69ea8c |
| Claim redeem, path B | `0xf36ed0bca53bf1e41589f038ae9e59024e57e8b7ad426b2db87540c585d0536d` | https://sepolia.basescan.org/tx/0xf36ed0bca53bf1e41589f038ae9e59024e57e8b7ad426b2db87540c585d0536d |

Current Base Sepolia vault state, rechecked with `cast call`:

```text
user = 0xBa2e781d4C3974C8D2357a7535D8E0d52433c935
vault code bytes = 32753
totalSupply = 399870
user mETF balance = 399870
totalAssets = 399870
totalManagedAssets = 399870
reservedRedeemAssets = 0
vault USDC balance = 0
```

## Solana CCTP And Mock Basket Evidence

Solana devnet transactions were rechecked with `solana confirm -v`.

| Step | Tx | URL |
| --- | --- | --- |
| CCTP receive after deposit | `3MKyDpvixWoryeeWBN6H7RTnfKSfSZ7sEkD6eDtgiL3QVQfrTakZjPVh11eNYJS72FgLSKNLXJrX88rR6zWXy9iS` | https://explorer.solana.com/tx/3MKyDpvixWoryeeWBN6H7RTnfKSfSZ7sEkD6eDtgiL3QVQfrTakZjPVh11eNYJS72FgLSKNLXJrX88rR6zWXy9iS?cluster=devnet |
| Reverse CCTP burn for redeem | `2Ze5UZhNbhAB2qm4GnNa7gSb4t4wEJH7XkHy2RfYhqgi2JRAgYRkhFRGgMAb8tVcG3dv1mmY5uXN3fkG1gPcpn8V` | https://explorer.solana.com/tx/2Ze5UZhNbhAB2qm4GnNa7gSb4t4wEJH7XkHy2RfYhqgi2JRAgYRkhFRGgMAb8tVcG3dv1mmY5uXN3fkG1gPcpn8V?cluster=devnet |

Mock xStock SPL reserve balances, rechecked through Solana RPC:

```text
AAPLx mint=BMeDxtxKMSFuU3yRepuJDTcn7WpbFhstXAnB8fMLYf1p balance=3999480 decimals=9
TSLAx mint=8qrYLgZYkxyv1N8tAPbmufDnok8WY8ALMwaKdAH8PJtu balance=1714062 decimals=9
NVDAx mint=HVcRqp4sePBbrAAPG3zKRRtidPkK6i6e3uJQivT2t6mb balance=599922 decimals=9
```

## CCIP Control-Plane Evidence

This is a separate proof that Base can send an allocation instruction into a Solana program using CCIP. It is not the CCTP settlement rail.

| Step | Tx / message | URL |
| --- | --- | --- |
| Deploy Solana custody program | `wqa5hQB1L5AZh4K9d9wGZmLsdu5o86J3EXPsjDGW7neRhcnQTbjkM2RL9LtyQZjzPejjDivmwgzVrduLpZ616yJ` | https://explorer.solana.com/tx/wqa5hQB1L5AZh4K9d9wGZmLsdu5o86J3EXPsjDGW7neRhcnQTbjkM2RL9LtyQZjzPejjDivmwgzVrduLpZ616yJ?cluster=devnet |
| Initialize custody state | `4SkTbUAuxhbfR1w6ogMBHUefkXNCzfXWvyyVbzdQ4EosfxcCGYzK2cKc6HcV2YGBUJQ7LzgomGw1KK2VSWJjqeQY` | https://explorer.solana.com/tx/4SkTbUAuxhbfR1w6ogMBHUefkXNCzfXWvyyVbzdQ4EosfxcCGYzK2cKc6HcV2YGBUJQ7LzgomGw1KK2VSWJjqeQY?cluster=devnet |
| Deploy Base CCIP sender | `0xf3f53eeb4850db6668bf70051624e7d1274207bf69fb1233ecb8ce35561939cf` | https://sepolia.basescan.org/tx/0xf3f53eeb4850db6668bf70051624e7d1274207bf69fb1233ecb8ce35561939cf |
| Approve Base sender on Solana | `546qvW7afLPUEFsKsuJN5uWR6G9FGNiBQJyXCy4amFvoBwz5BzKjkk1Py2SSJTcbWLQ9fGruQQqYoWhoCpKPCAd1` | https://explorer.solana.com/tx/546qvW7afLPUEFsKsuJN5uWR6G9FGNiBQJyXCy4amFvoBwz5BzKjkk1Py2SSJTcbWLQ9fGruQQqYoWhoCpKPCAd1?cluster=devnet |
| Send CCIP allocation | `0xea504d341e7c55aff419e852059673236819b5025a09b40b2ee9e8af20cd28f5` | https://sepolia.basescan.org/tx/0xea504d341e7c55aff419e852059673236819b5025a09b40b2ee9e8af20cd28f5 |
| CCIP message | `0xce79ae692e4be7401a7fd08249e6e602847e95f47b6c5d1f168158517bd683b1` | https://ccip.chain.link/msg/0xce79ae692e4be7401a7fd08249e6e602847e95f47b6c5d1f168158517bd683b1 |
| Solana CCIP execution | `3bzBr7v2KZnYVLD7GAX42Q76xsoVKYLzuqwfXoAmetxyFLqUN4U1oPZ2yto3PqJ3NKMT8vabrWcKZttTQxhy8qwz` | https://explorer.solana.com/tx/3bzBr7v2KZnYVLD7GAX42Q76xsoVKYLzuqwfXoAmetxyFLqUN4U1oPZ2yto3PqJ3NKMT8vabrWcKZttTQxhy8qwz?cluster=devnet |

Current Solana custody state, rechecked with `npm run ccip:solana-custody -- show`:

```text
program = 4LaatT5FGgWMkFfT3zLUSEnsaWegk52a2nEwk8VRR881
state = BTZCDfAhtoMCiGBWZ78KQnsoML2cKRcB9f2nJcC1yDcg
messageCount = 3
aaplUnits = 12
tslaUnits = 9
nvdaUnits = 9
lastSourceChainSelector = 10344971235874465080
lastMessageId = 0xce79ae692e4be7401a7fd08249e6e602847e95f47b6c5d1f168158517bd683b1
```

## Presentation Claim Boundary

The correct claim is:

```text
We implemented and verified an on-chain multi-chain ETF-like async lifecycle PoC:
Base is the canonical ERC-7540 share/accounting chain, CCTP moves USDC settlement
between Base and Solana, Solana holds a visible mock basket reserve, and CCIP
proves a separate Base-to-Solana instruction/control path.
```

The incorrect claim is:

```text
We built a production ETF or executed real issuer-backed xStock trades.
```
