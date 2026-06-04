# CCIP Devnet E2E Evidence

This page records Chainlink CCIP evidence for the OmniETF presentation.

Important scope boundary: USDC settlement in the OmniETF vault demo uses Circle CCTP. CCIP is verified here as a Base/Solana control-message rail and as a CCIP-BnM test-token round trip. Do not present this as "USDC via CCIP".

## Deployed Programs And Contracts

| Surface | Address | Code |
| --- | --- | --- |
| Solana custody receiver program | `4LaatT5FGgWMkFfT3zLUSEnsaWegk52a2nEwk8VRR881` | `solana/omnietf-custody/programs/omnietf-custody/src/lib.rs` |
| Base Sepolia CCIP sender | `0xD340cECB276600082546e7F161c1D577767BA89f` | `contracts/OmniETFCCIPSender.sol` |

## Chainlink CCIP Configuration

| Item | Value |
| --- | --- |
| Source chain | Base Sepolia |
| Source selector | `10344971235874465080` |
| Source router | `0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93` |
| Destination chain | Solana Devnet |
| Destination selector | `16423721717087811551` |
| Destination router | `Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C` |
| OffRamp observed by CCIP API | `offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm` |

## Final Contract-Based E2E

| Step | Tx / Message | URL |
| --- | --- | --- |
| Deploy Solana custody program | `wqa5hQB1L5AZh4K9d9wGZmLsdu5o86J3EXPsjDGW7neRhcnQTbjkM2RL9LtyQZjzPejjDivmwgzVrduLpZ616yJ` | https://explorer.solana.com/tx/wqa5hQB1L5AZh4K9d9wGZmLsdu5o86J3EXPsjDGW7neRhcnQTbjkM2RL9LtyQZjzPejjDivmwgzVrduLpZ616yJ?cluster=devnet |
| Initialize custody state | `4SkTbUAuxhbfR1w6ogMBHUefkXNCzfXWvyyVbzdQ4EosfxcCGYzK2cKc6HcV2YGBUJQ7LzgomGw1KK2VSWJjqeQY` | https://explorer.solana.com/tx/4SkTbUAuxhbfR1w6ogMBHUefkXNCzfXWvyyVbzdQ4EosfxcCGYzK2cKc6HcV2YGBUJQ7LzgomGw1KK2VSWJjqeQY?cluster=devnet |
| Deploy final Base sender contract | `0xf3f53eeb4850db6668bf70051624e7d1274207bf69fb1233ecb8ce35561939cf` | https://sepolia.basescan.org/tx/0xf3f53eeb4850db6668bf70051624e7d1274207bf69fb1233ecb8ce35561939cf |
| Approve final Base sender on Solana | `546qvW7afLPUEFsKsuJN5uWR6G9FGNiBQJyXCy4amFvoBwz5BzKjkk1Py2SSJTcbWLQ9fGruQQqYoWhoCpKPCAd1` | https://explorer.solana.com/tx/546qvW7afLPUEFsKsuJN5uWR6G9FGNiBQJyXCy4amFvoBwz5BzKjkk1Py2SSJTcbWLQ9fGruQQqYoWhoCpKPCAd1?cluster=devnet |
| Send CCIP message from Base sender | `0xea504d341e7c55aff419e852059673236819b5025a09b40b2ee9e8af20cd28f5` | https://sepolia.basescan.org/tx/0xea504d341e7c55aff419e852059673236819b5025a09b40b2ee9e8af20cd28f5 |
| CCIP message id | `0xce79ae692e4be7401a7fd08249e6e602847e95f47b6c5d1f168158517bd683b1` | https://ccip.chain.link/msg/0xce79ae692e4be7401a7fd08249e6e602847e95f47b6c5d1f168158517bd683b1 |
| Solana CCIP execution receipt | `3bzBr7v2KZnYVLD7GAX42Q76xsoVKYLzuqwfXoAmetxyFLqUN4U1oPZ2yto3PqJ3NKMT8vabrWcKZttTQxhy8qwz` | https://explorer.solana.com/tx/3bzBr7v2KZnYVLD7GAX42Q76xsoVKYLzuqwfXoAmetxyFLqUN4U1oPZ2yto3PqJ3NKMT8vabrWcKZttTQxhy8qwz?cluster=devnet |

Final CCIP API status:

```text
status=SUCCESS
receipt=3bzBr7v2KZnYVLD7GAX42Q76xsoVKYLzuqwfXoAmetxyFLqUN4U1oPZ2yto3PqJ3NKMT8vabrWcKZttTQxhy8qwz
source=Base Sepolia
dest=Solana Devnet
```

Final Solana custody state:

```text
state=BTZCDfAhtoMCiGBWZ78KQnsoML2cKRcB9f2nJcC1yDcg
tokenAdmin=AfX9hJkMZXKsiU1Z4Z9YLhAUUNTGrjEVoQXLNpKS5EhH
messageCount=3
aaplUnits=12
tslaUnits=9
nvdaUnits=9
lastSourceChainSelector=10344971235874465080
lastMessageId=0xce79ae692e4be7401a7fd08249e6e602847e95f47b6c5d1f168158517bd683b1
```

The final message increments the custody state by `AAPL=4`, `TSLA=3`, `NVDA=3`. The current totals are `12/9/9` because two earlier successful CCIP messages used the same allocation payload during verification.

## CCIP-BnM Token Round Trip Evidence

This is the presentation-safe CCIP token movement claim: CCIP-BnM moved from Base Sepolia to Solana Devnet, then back from Solana Devnet to Base Sepolia.

| Leg | Tx / Message | URL |
| --- | --- | --- |
| Faucet CCIP-BnM on Base Sepolia | `0xd6e936091819fdd65223acf354d7286beff07b7615607f4889b43b0dc08eeaa9` | https://sepolia.basescan.org/tx/0xd6e936091819fdd65223acf354d7286beff07b7615607f4889b43b0dc08eeaa9 |
| Base Sepolia -> Solana Devnet send tx | `0xe91a94ee5f63390fa6fe56ed00e806cbfaddfcefad8523a10fcd998d140692c7` | https://sepolia.basescan.org/tx/0xe91a94ee5f63390fa6fe56ed00e806cbfaddfcefad8523a10fcd998d140692c7 |
| Base -> Solana CCIP message | `0xd59ab6761bbd84bf3a1e798fe2ac4141885773b21331f89791d64fac572ab330` | https://ccip.chain.link/msg/0xd59ab6761bbd84bf3a1e798fe2ac4141885773b21331f89791d64fac572ab330 |
| Solana execution receipt | `5awViaX7m1ZaXnY2cqMS2f5v9w8hAtqbtPvmRgrYu8cqfHjqw44xXppJzDasWwo1cRgP1tvhwEu2GfjD4n83246P` | https://explorer.solana.com/tx/5awViaX7m1ZaXnY2cqMS2f5v9w8hAtqbtPvmRgrYu8cqfHjqw44xXppJzDasWwo1cRgP1tvhwEu2GfjD4n83246P?cluster=devnet |
| Solana Devnet -> Base Sepolia send tx | `4S1wEGD79dqGuGJaAX8LRbxHuGDHRiWnf3rt7ksvuAVFHTwygn6TpWoe8tLopB6Lxafp8LPNCJvxifvmsfSw3PPj` | https://explorer.solana.com/tx/4S1wEGD79dqGuGJaAX8LRbxHuGDHRiWnf3rt7ksvuAVFHTwygn6TpWoe8tLopB6Lxafp8LPNCJvxifvmsfSw3PPj?cluster=devnet |
| Solana -> Base CCIP message | `0xb514339ec99fd6d2dec6047232f535d7ed247d7b4889619965350f818b081dc8` | https://ccip.chain.link/msg/0xb514339ec99fd6d2dec6047232f535d7ed247d7b4889619965350f818b081dc8 |
| Base execution receipt | `0x3f9c336f6d71466c92e86dd4cec31931bda07a1e9cbcab920cdc09ba0b19586a` | https://sepolia.basescan.org/tx/0x3f9c336f6d71466c92e86dd4cec31931bda07a1e9cbcab920cdc09ba0b19586a |

Presentation summary:

```text
token=CCIP-BnM
amount=0.001
base_to_solana_status=SUCCESS
solana_to_base_status=SUCCESS
base_balance=0.999 -> 1.0
solana_balance=0.001 -> 0
```

## Repro Commands

```bash
forge build --contracts contracts/OmniETFCCIPSender.sol
cd solana/omnietf-custody && cargo test --lib
npm run ccip:solana-custody -- show
npm run ccip:contract-base-solana -- quote 0xD340cECB276600082546e7F161c1D577767BA89f
```

## Earlier Successful Verification Messages

| Sender | Source tx | Message id | Solana receipt |
| --- | --- | --- | --- |
| EOA `0xBa2e781d4C3974C8D2357a7535D8E0d52433c935` | `0x5f56e0b6bcae98ec300672bdffb4ff1c415369d34d6ede0bd25839d5e3989879` | `0x4caf68a39158430db1371f371cfce7490eb882df4b955268b088faef852bd902` | `5PFUKivSgTetvLdo5niw1crfEA3XmDyd8nRgRP8d4dYKzUnc5ZFoJPPkQ6YDEKNz7MBNchRrygYgyu2coEHq6z9h` |
| First sender contract `0x3797C7D4e3653948A46848BB193297124DD7F922` | `0xde816124e293e3b063c8ba48a7236400bc0216ae853e5e0b46d396e827d34fb5` | `0xabe174c55737fdb92ac0d439da9e77b3ef77ad831856484a005ce0aea09c7b44` | `4vM26Vp8qdP8tBBPda78o1FVqXeeQSoHo4aKt1aGkV1vii96ndvCDn915wqJ2WvdLCQsou41pX9hAuuSQTnTrUye` |
