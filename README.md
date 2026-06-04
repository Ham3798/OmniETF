# OmniETF

블록체인 실무응용 팀 프로젝트입니다.

## 개요

OmniETF는 여러 체인에 분산된 자산 상태를 하나의 인덱스 토큰으로 묶는 멀티체인 ETF 구조를 구현합니다.

## 목표

- 멀티체인 자산 인덱싱
- 교환비 기반 토큰 발행
- CCTP 기반 USDC settlement
- ERC-7540식 비동기 deposit / redeem lifecycle
- CCIP control message 및 CCIP-BnM round trip 검증
- 상환 흐름 검증

## 구성

- `contracts`: 스마트 컨트랙트 구현
- `scripts`: 배포 및 실행 스크립트
- `docs`: 설계 문서 및 발표 자료
- `docs/demo-runbook.md`: 발표 데모 순서와 fallback
- `docs/code-review-scope.md`: 코드리뷰 범위와 체크리스트
- `docs/completion-audit.md`: 현재 완성 범위와 검증 증거

## 현재 end-to-end 범위

현재 구현체는 실제 규제형 ETF가 아니라 ETF-like cross-chain basket share PoC입니다.

검증된 경로:

1. Base Sepolia에서 사용자가 USDC deposit request 생성
2. Circle CCTP V2로 USDC를 Solana devnet token account에 settlement
3. Solana devnet에서 mock xStock SPL basket custody 구성
4. reporter가 Solana 실행 가치를 Base `OmniETFAsyncVault`에 보고
5. Base에서 canonical `mETF` share mint
6. 사용자가 `mETF` redeem request 생성
7. reporter가 redeem을 claimable로 확정
8. 사용자가 standard `redeem` / compatibility `claimRedeem`으로 Base-side USDC payout claim
9. Chainlink CCIP로 Base Sepolia ↔ Solana Devnet CCIP-BnM test token round trip 검증

표준 정합성 검증용으로 `contracts/OmniETFOZAsyncVault.sol`도 포함합니다. 이 컨트랙트는 OpenZeppelin Community Contracts의 공식 `ERC7540` base를 직접 상속하고, 그 위에 CCTP deposit request, reporter settlement, redeem payout reservation, executed-value accounting, `AccessManaged` 운영 권한을 얹은 버전입니다.

아직 production 범위가 아닌 것:

- issuer-backed xStock 실제 매수/매도
- production-grade Solana -> Base CCTP 역방향 USDC funding 자동화
- permissionless oracle / reporter network
- 자동 리밸런싱
- 법적 ETF 운용 구조

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
npm run review:check
```

## Async Vault / mETF PoC

Base의 `mETF`는 OpenZeppelin ERC-20 share token이고, 발행 타이밍은 ERC-7540 비동기 lifecycle을 따릅니다. 사용자가 USDC를 예치해도 바로 `mETF`를 받지 않고, `Pending -> Settled -> Claimable -> Claimed` 상태를 거쳐 Solana 실행 결과가 reporter로 확정된 뒤에 standard `deposit(assets, receiver, controller)` 또는 `mint(shares, receiver, controller)`로 claim합니다.

구현은 두 갈래입니다. `OmniETFAsyncVault`는 발표 데모용 운영형 PoC로 OpenZeppelin `AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeERC20` 등을 붙여 ERC-7540/ERC-7575 표면을 직접 구현합니다. `OmniETFOZAsyncVault`는 “표준 컨트랙트 그대로 가져오기”에 맞춘 버전으로, OpenZeppelin Community `ERC7540` base가 operator, pending/claimable accounting, async preview revert, ERC-4626/ERC-7575 routing을 담당하고 `AccessManager`가 reporter/pauser 운영 권한을 관리합니다.

토큰 표준 관점의 현재 스코프:

- `ERC-20`: OpenZeppelin 기반 Base canonical share token인 `mETF`
- `ERC-4626`: `assets <-> shares`와 NAV 계산의 기준 수식
- `ERC-7540`: `requestId`, operator approval, pending/claimable request 조회, 비동기 lifecycle
- `ERC-7575`: 장기적으로 여러 asset entry point가 하나의 share supply를 공유하는 확장 모델
- `ERC-7621`: `AAPLx 40% / TSLAx 30% / NVDAx 30%` basket weight vocabulary
- `SPL Token`: Solana devnet mock xStock reserve custody
- `CCTP`: Base USDC를 Solana reserve capital로 이동시키는 settlement rail
- `CCIP`: Base/Solana control message와 CCIP-BnM test token 왕복 검증 rail

CCIP는 USDC settlement 실행 경로가 아닙니다. 이번 PoC에서는 Base/Solana control message와 CCIP-BnM test token round trip까지 검증했고, USDC production settlement는 CCTP 중심으로 분리합니다.

```bash
forge script script/DeployOmniETFAsyncVault.s.sol:DeployOmniETFAsyncVault \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

# 공식 OpenZeppelin ERC7540 base + AccessManager 기반 배포:
forge script script/DeployOmniETFOZAsyncVault.s.sol:DeployOmniETFOZAsyncVault \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/RequestOmniETFDeposit.s.sol:RequestOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/FinalizeOmniETFDeposit.s.sol:FinalizeOmniETFDeposit \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

이 구조에서 ERC-4626은 `assets <-> shares` 수식의 기준이고, 실제 deposit/redeem lifecycle은 cross-chain 체결 타이밍 때문에 ERC-7540 async request/claim 모델로 분리합니다. 현재 vault는 `IERC7540` / `IERC7575` 인터페이스 표면을 구현하고, `requestId`, `setOperator/isOperator`, pending/claimable request 조회, standard `deposit`, `mint`, `withdraw`, `redeem` claim 경로를 제공합니다. CCTP에 필요한 Solana 수령 계정과 max fee는 `setDepositRoute`로 controller가 미리 등록합니다.

Redeem lifecycle은 Base vault에서 `Pending -> Claimable -> Claimed`까지 구현되어 있습니다. redeem request는 share를 vault escrow로 이동시키고, reporter가 reverse settlement로 확보한 USDC를 `fundRedeemPayout`으로 vault에 입금하면 request가 claimable이 됩니다. reverse CCTP가 vault 주소로 직접 USDC를 민트한 경우에는 vault의 미예약 USDC 잔고를 확인한 뒤 `markRedeemClaimable`만 호출할 수 있습니다. 이후 `redeem` / `withdraw`가 escrow share를 burn하고 예약된 USDC를 사용자에게 전송합니다. Solana asset 매도와 역방향 CCTP 송신 자동화는 외부 운영 단계로 남아 있지만, Base-side funding/reserve/claim/payout 컨트랙트 경로는 end-to-end로 테스트됩니다.

```bash
forge script script/RequestOmniETFRedeem.s.sol:RequestOmniETFRedeem \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/FundOmniETFRedeemPayout.s.sol:FundOmniETFRedeemPayout \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

# If reverse CCTP minted USDC directly to the vault, mark the funded request without pulling reporter USDC:
forge script script/MarkOmniETFRedeemClaimable.s.sol:MarkOmniETFRedeemClaimable \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast

forge script script/ClaimOmniETFRedeem.s.sol:ClaimOmniETFRedeem \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

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
npm run portfolio:settle-redeem -- --shares 0.5
npm run portfolio:execute-redeem -- --shares 0.5
npm run cctp:burn-solana
npm run cctp:receive-evm
```

기본 바스켓은 `AAPLx 40%`, `TSLAx 30%`, `NVDAx 30%`이며, `1 received USDC = 1 OmniETF share`로 계산합니다. `xstock:allocate`는 devnet mock SPL mint를 만들고 treasury token account에 mock xStock 잔고를 실제 온체인으로 mint합니다. `portfolio:execute-redeem`은 mock basket 잔고를 차감하고 Solana -> Base reverse CCTP burn intent, `REDEEM_ASSETS_CLAIMABLE`, 그리고 vault direct-funding 후 `markRedeemClaimable` 명령을 생성합니다. `cctp:burn-solana`는 Solana CCTP V2 `depositForBurn`을 제출하고, `cctp:receive-evm`은 Circle attestation을 받아 Base `MessageTransmitterV2.receiveMessage`를 호출합니다. 실제 발행사 xStock/Jupiter swap은 다음 단계 확장 범위입니다.

전체 CLI 데모를 한 번에 실행하려면:

```bash
npm run demo:e2e
```

## 발표 자료

- Slidev 원본: `slides.md`
- PPTX 출력: `OmniETF.pptx`
- PDF 출력: `OmniETF.pdf`

발표 자료를 다시 생성하려면:

```bash
npm run slides:export
```

## Demo UI

발표 중 라이브 전송 대신 이미 검증된 tx와 현재 로컬 ledger를 한 화면에서 보여주는 evidence console입니다. 새 백엔드를 크게 만들지 않고, 기존 CLI와 `.omnietf/*.json` 상태 파일을 감싸는 구조입니다.

```bash
npm run demo:ui
```

기본 주소:

```text
http://localhost:4173
```

UI에서 가능한 것:

- Base Sepolia wallet 연결과 사용자 chain context 표시
- CCTP/vault/CCIP 증거 링크 확인
- CCIP control message, Base -> Solana BnM, Solana -> Base BnM round trip 분리 표시
- `requestDeposit`, `finalizeDeposit`, `claimRedeem`, `sendAllocate` 컨트랙트 코드 path 확인
- 현재 portfolio ledger, NAV, mock xStock allocation 확인
- redeem quote 확인
- 기존 CLI 단계 실행: `portfolio:allocate`, `portfolio:nav`, `portfolio:redeem`, `portfolio:execute-redeem`, `vault:demo`, `demo:e2e`

### Demo UI를 읽는 법

데모 화면은 "투자 앱"처럼 보이지만, 실제 목적은 cross-chain ETF-like lifecycle의 증거를 한 화면에 모으는 것입니다. 사용자가 누르는 버튼은 `Approve -> Buy -> Claim -> Redeem` 네 가지이고, 아래 상태판은 각 단계가 어느 체인과 rail에서 어떤 상태로 남았는지를 보여줍니다.

#### Top flow

| UI | 역할 | 해석 |
|---|---|---|
| `Approve` | Base Sepolia USDC allowance 설정 | 사용자가 vault가 USDC를 가져갈 수 있도록 ERC-20 allowance를 엽니다. |
| `Buy` | Base vault의 async deposit request | `OmniETFOZAsyncVault.requestDeposit`이 호출되고, CCTP burn/settlement가 시작됩니다. 이 시점에는 `mETF`가 바로 mint되지 않습니다. |
| `Claim` | 확정된 deposit을 share로 claim | CCTP 수신과 reporter finalization 이후 `maxDeposit`/`Claimable`이 생기면 `mETF`를 mint합니다. |
| `Redeem` | share 환매 요청과 payout claim | 먼저 `mETF`가 escrow/burn 경로로 들어가고, payout이 funding되면 Base-side USDC를 claim합니다. |

#### Base panel

| UI | 연결 대상 | 역할 | 해석 |
|---|---|---|---|
| `Connected to Base Sepolia` | 사용자의 injected wallet | 현재 브라우저 세션의 지갑과 chain context | `chainId 0x14a34`이면 Base Sepolia입니다. 다른 체인이면 tx가 잘못된 네트워크로 나갑니다. |
| `0xba2e...c935` | 사용자 EVM 주소 | 현재 시연 계정 | `Wallet USDC`, `USDC allowance`, `mETF balance`, `Claimable`은 이 주소 기준으로 읽습니다. |
| `Vault 0x77cA...f25e` | [`OmniETFOZAsyncVault` on Base Sepolia](https://sepolia.basescan.org/address/0x77cAea5FDF52fD0C59577ED4739D9A49588Ff25e) | canonical share supply와 async request accounting | Base에서 `mETF` 발행량, deposit/redeem request, claimable 상태가 기록되는 핵심 컨트랙트입니다. |
| `Wallet USDC` | Base Sepolia USDC balance | 사용자의 결제 자산 잔고 | `Approve`/`Buy` 전후로 사용자가 실제로 지불 가능한 USDC를 보여줍니다. |
| `USDC allowance` | USDC ERC-20 allowance to vault | vault가 가져갈 수 있는 한도 | `Approve` 후 증가하고, `Buy`가 실행되면 사용된 만큼 감소합니다. |
| `mETF balance` | vault share balance | 사용자의 canonical ETF-like share | `Claim` 전에는 0일 수 있습니다. `Buy`는 request일 뿐이고, share는 finalization 이후 `Claim`에서 생깁니다. |
| `Claimable` | `maxDeposit(user)` | 지금 claim 가능한 확정 deposit | CCTP와 reporter가 끝나기 전에는 0입니다. 이 값이 생기면 `Claim`으로 `mETF`를 받을 수 있습니다. |

#### CCTP panel

| UI | 연결 대상 | 역할 | 해석 |
|---|---|---|---|
| `Attestation` | Circle CCTP Iris API | Base burn tx의 message/attestation 상태 | `no fresh buy`는 현재 브라우저 세션에 새 `Buy` tx가 없다는 뜻입니다. 실패가 아니라 추적할 fresh tx가 없다는 표시입니다. |
| `Tx` | Base deposit tx | CCTP status lookup의 source tx | `Buy` 직후에는 Basescan tx 링크가 표시되고, 그 tx에서 Circle message를 찾습니다. |
| `Destination Circle CCTP` | [Solana CCTP TokenMessengerMinter V2](https://explorer.solana.com/address/CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe?cluster=devnet) | Solana 쪽 CCTP mint program | Base에서 burn된 USDC를 Solana devnet USDC로 mint하는 Circle settlement rail입니다. |
| `Mint USDC account` | [Solana USDC token account](https://explorer.solana.com/address/9y7ns4FyHSFscz5yvgAfchDVzr9VUsyDSx56VttABut?cluster=devnet) | CCTP 수신 토큰 계정 | `Buy`가 settle되면 이 token account의 USDC balance가 증가합니다. |
| `Latest mint` | Solana token account latest signature | 가장 최근 Solana 수신 증거 | 링크는 token account에 찍힌 최신 tx입니다. CCTP program tx와 vault tx가 다르게 보이는 이유는 settlement가 Solana CCTP program에서 처리되기 때문입니다. |
| `Balance` | Solana token account balance | Solana reserve capital | Base에서 보낸 USDC가 Solana 쪽 reserve capital로 도착했는지 확인하는 숫자입니다. |

#### CCIP / Solana panel

| UI | 연결 대상 | 역할 | 해석 |
|---|---|---|---|
| `Program 4Laat...R881` | [OmniETF Solana custody program](https://explorer.solana.com/address/4LaatT5FGgWMkFfT3zLUSEnsaWegk52a2nEwk8VRR881?cluster=devnet) | CCIP receiver / custody proof program | CCIP control message를 받아 basket accounting state를 갱신하는 Solana devnet 프로그램입니다. USDC CCTP mint program과는 별개입니다. |
| `State BTZC...yDcg` | [Solana custody state account](https://explorer.solana.com/address/BTZCDfAhtoMCiGBWZ78KQnsoML2cKRcB9f2nJcC1yDcg?cluster=devnet) | CCIP message 처리 결과 저장소 | message count, basket counters, last message id가 저장되는 program state입니다. |
| `Rail CCIP receiver` | Chainlink CCIP path | control message / test-token rail | 현재 PoC에서 CCIP는 USDC settlement가 아니라 control message와 CCIP-BnM round trip 증거입니다. |
| `Messages` | custody state counter | Solana program이 처리한 CCIP message 수 | 값이 증가하면 CCIP receiver path가 Solana program state를 바꿨다는 뜻입니다. |
| `Basket 16/12/12` | AAPLx / TSLAx / NVDAx mock basket counters | Solana reserve-side basket accounting | issuer-backed xStock이 아니라 devnet mock SPL/basket accounting입니다. 발표에서는 "real xStock 체결"로 말하면 안 됩니다. |
| `Redeem` | custody state redeem counter | redeem-side control/accounting counter | 현재 UI의 production redeem payout은 Base vault funding/claim 경로 중심이며, 이 값은 Solana custody program의 redeem 상태 증거입니다. |
| `Last CCIP message` | Chainlink CCIP message id | 마지막으로 처리한 CCIP message | 링크가 있으면 CCIP Explorer에서 source/destination execution 상태를 확인할 수 있습니다. |

#### Session tx stack

`Session tx`는 현재 브라우저 세션에서 사용자가 직접 발생시킨 tx를 아래로 쌓는 local evidence log입니다. EVM tx는 receipt를 읽어 `status`, `block`, `gasUsed`, 주요 log `topic0`을 표시합니다. 알려진 topic은 `Approval`, `Transfer`, `DepositRequest`, `DepositSettled`, `DepositExecuted`, `Deposit`, `RedeemRequest`, `Withdraw` 같은 이벤트명으로 라벨링합니다. Solana `receiveMessage`처럼 API/relayer가 만든 외부 tx도 같은 스택에 `External` tx로 쌓입니다.

이 스택은 브라우저 `localStorage` 기반이므로 새로고침해도 유지되지만, 다른 브라우저나 다른 기기와 공유되는 영구 백엔드 로그는 아닙니다. `Clear` 버튼은 이 로컬 세션 증거만 지웁니다.

### UI 해석의 핵심

- `Buy`가 성공해도 즉시 `mETF balance`가 늘지 않는 것이 정상입니다. cross-chain execution value가 확정되기 전 mint를 금지하기 때문입니다.
- CCTP tx는 Solana의 `Circle CCTP` program과 `USDC account`에 찍히고, CCIP tx는 별도의 `Solana Program`과 `State`에 찍힙니다.
- `CCTP = USDC settlement`, `CCIP = control message / CCIP-BnM evidence`로 구분해서 봐야 합니다.
- `Claimable`은 Base vault가 reporter-finalized executed value를 반영했는지를 보여주는 숫자입니다.
- `Basket`은 Solana reserve-side accounting이 보이는 증거지만, 현재는 issuer-backed xStock 체결이 아니라 devnet mock basket입니다.

Vercel 정적 배포용 산출물:

```bash
npm run build
npm run verify:demo-ui
```

배포 설정:

- `vercel.json`: build command와 `demo-dist` output directory 지정
- `.vercelignore`: `.env`, 키, build/cache/library 대용량 파일 제외
- `.github/workflows/deploy-demo-vercel.yml`: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` secret 기반 자동 배포
- 자세한 배포 runbook: `docs/vercel-demo-deploy.md`

주의:

- USDC settlement claim은 CCTP 기준입니다.
- CCIP는 control message와 CCIP-BnM test token round trip evidence입니다.
- issuer-backed xStock trading UI가 아니라 devnet mock SPL reserve accounting UI입니다.
