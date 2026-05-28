# Architecture Notes

## 시스템 레이어

```text
User
  |
  v
Base Vault (mETF share accounting)
  |
  v
Mock Bridge / Cross-chain relayer
  |
  v
Solana Executor (portfolio engine)
  |
  v
Treasury (AAPLx / TSLAx / NVDAx)
```

## Base 역할

- deposit 수령
- share mint/burn
- active NAV 기준 share price 계산
- redeem reservation 관리
- bridge return 이후 settlement

## Solana 역할

- 목표 비중대로 스왑 실행
- 가격 변화 반영
- 부분 청산 및 rebalance
- treasury NAV 계산

## Async Redeem 설계

멀티체인 구조에서는 전형적인 ERC-4626 `redeem()`처럼 한 트랜잭션 안에 자산을 바로 내주기 어렵습니다.

이 PoC는 아래 절충안을 사용합니다.

1. `requestRedeem(shares, receiver)`
2. Vault가 share를 burn하고 redeem 금액을 `reservedRedemptionAssets`로 고정
3. Solana executor가 해당 금액만큼 자산 청산
4. Bridge가 USDC를 Base Vault로 반환
5. `settleRedeem(redemptionId)`로 사용자 지급

이 방식 덕분에:

- 기존 보유자의 NAV 희석을 막을 수 있고
- bridge latency를 모델링할 수 있으며
- PoC 단계에서 가장 단순한 cross-chain accounting을 유지할 수 있습니다

## 데이터 흐름

### Deposit

```text
User deposit USDC
-> Vault mints mETF shares
-> Owner/relayer bridges idle USDC out
-> Solana executor allocates portfolio
-> Updated Solana NAV is synced back to Base
```

### Redeem

```text
User requests redeem
-> Vault burns shares and reserves claim
-> Solana executor liquidates pro-rata
-> Bridge returns USDC to Base
-> Vault settles redeem
```

## PoC에서 단순화한 부분

- bridge는 `MockBridge`로 대체
- oracle 대신 수동 NAV sync 사용
- executor 권한은 단일 `owner`
- ETF 구성 종목은 고정 `AAPLx/TSLAx/NVDAx`
- 수수료, slippage, 실패 재시도는 모델링하지 않음
