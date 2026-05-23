# OmniETF

블록체인 실무응용 팀 프로젝트입니다.

## 개요

OmniETF는 여러 체인에 분산된 자산 상태를 하나의 인덱스 토큰으로 묶는 멀티체인 ETF 구조를 구현합니다.

## 목표

- 멀티체인 자산 인덱싱
- 교환비 기반 토큰 발행
- CCTP 기반 USDC settlement
- ERC-7540식 비동기 deposit / redeem lifecycle
- 상환 흐름 검증

## 구성

- `contracts`: 스마트 컨트랙트 구현
- `scripts`: 배포 및 실행 스크립트
- `docs`: 설계 문서 및 발표 자료

## CCTP PoC

현재 첫 구현은 Circle CCTP를 직접 재구현하지 않고, 이미 배포된 `TokenMessengerV2`를 호출하는 최소 wrapper입니다.

- `contracts/CctpDepositRouter.sol`: 사용자 USDC를 받아 CCTP `depositForBurn` 호출
- `test/CctpDepositRouter.t.sol`: mock USDC / mock TokenMessenger 기반 단위 테스트
- `script/DeployCctpDepositRouter.s.sol`: Base Sepolia 배포 스크립트
- `script/StartCctpDeposit.s.sol`: USDC approve 후 deposit 시작 스크립트
- `docs/cctp-router.md`: 실행 순서와 확인해야 할 이벤트

검증:

```bash
forge build
forge test
```

## Async Vault / mETF PoC

Base의 `mETF`는 ERC-20 share token이고, 발행 타이밍은 ERC-7540식 비동기 lifecycle을 따릅니다. 사용자가 USDC를 예치해도 바로 `mETF`를 받지 않고, `Requested -> Settled -> Executed -> Finalized` 상태를 거쳐 Solana 실행 결과가 reporter로 확정된 뒤에 `executed value / NAV before deposit` 기준으로 mint됩니다.

토큰 표준 관점의 현재 스코프:

- `ERC-20`: Base canonical share token인 `mETF`
- `ERC-4626`: `assets <-> shares`와 NAV 계산의 기준 수식
- `ERC-7540`: `requestDeposit -> execute on Solana -> finalizeDeposit` 비동기 lifecycle
- `ERC-7575`: 장기적으로 여러 asset entry point가 하나의 share supply를 공유하는 확장 모델
- `ERC-7621`: `AAPLx 40% / TSLAx 30% / NVDAx 30%` basket weight vocabulary
- `SPL Token`: Solana devnet mock xStock reserve custody
- `CCTP`: Base USDC를 Solana reserve capital로 이동시키는 settlement rail

CCIP는 이번 PoC의 실행 경로가 아니라, 향후 arbitrary messaging / control-plane 후보로 둡니다.

```bash
forge script script/DeployOmniETFAsyncVault.s.sol:DeployOmniETFAsyncVault \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/RequestOmniETFDeposit.s.sol:RequestOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/FinalizeOmniETFDeposit.s.sol:FinalizeOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

이 구조에서 ERC-4626은 `assets <-> shares` 수식의 기준이고, 실제 deposit/redeem lifecycle은 cross-chain 체결 타이밍 때문에 async request/finalize 모델로 분리합니다.

## ETF Mock Portfolio PoC

CCTP로 Solana devnet USDC 수신까지 완료한 뒤, 로컬 JSON ledger에서 xStock 포트폴리오를 mock으로 구성합니다.

```bash
npm run cctp:status -- <BASE_DEPOSIT_TX>
npm run cctp:receive-solana
npm run portfolio:allocate
npm run xstock:allocate
npm run xstock:balances
npm run portfolio:nav
npm run portfolio:redeem -- --shares 0.5
```

기본 바스켓은 `AAPLx 40%`, `TSLAx 30%`, `NVDAx 30%`이며, `1 received USDC = 1 OmniETF share`로 계산합니다. `xstock:allocate`는 devnet mock SPL mint를 만들고 treasury token account에 mock xStock 잔고를 실제 온체인으로 mint합니다. 실제 발행사 xStock/Jupiter swap과 Solana -> Base redeem CCTP는 다음 단계 확장 범위입니다.

전체 CLI 데모를 한 번에 실행하려면:

```bash
npm run demo:e2e
```

## 발표 자료

- Slidev 원본: `slides.md`
- PPTX 출력: `OmniETF.pptx`
- PDF 출력: `OmniETF.pdf`
