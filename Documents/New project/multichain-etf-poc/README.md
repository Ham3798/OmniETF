# Multichain ETF PoC

Base에서 ETF share를 발행하고, Solana에서 실제 포트폴리오 운용을 수행하는 멀티체인 ETF PoC입니다.

이 저장소는 해커톤 수준의 End-to-End 데모에 맞춰 아래 3가지를 같이 제공합니다.

- `base/`: Base 측 Vault, share accounting, mock bridge
- `solana/`: Solana executor로 옮길 수 있는 포트폴리오 엔진 코어
- `simulator/`: deposit -> bridge -> swap -> NAV -> redeem 흐름을 바로 보여주는 로컬 데모
- `relayer/`: cross-chain queue와 settlement를 흉내 내는 mock relayer
- `frontend/`: 브라우저에서 바로 보는 interactive mission control UI
- `docs/base-sepolia-live.md`: 실제 Base Sepolia 지갑 연동 가이드

## 핵심 아이디어

- 사용자는 Base에서 `mETF` share를 받음
- 실제 자산 운용은 Solana executor가 수행
- Bridge는 Base와 Solana 사이의 settlement rail 역할
- redeem는 비동기 settlement를 반영한 `requestRedeem -> bridge return -> settle` 흐름으로 처리

## 폴더 구조

```text
multichain-etf-poc
├── base
│   ├── src
│   └── test
├── docs
├── shared
├── simulator
└── solana
```

## Base 측 구성

- `MockUSDC.sol`
  Base deposit asset
- `MockBridge.sol`
  Base <-> Solana 이동을 흉내 내는 bridge mock
- `MultiChainETFVault.sol`
  ERC-4626 스타일의 deposit/share accounting과 async redeem settlement를 담은 Vault

Vault는 아래 상태를 분리합니다.

- `baseIdleAssets`: 아직 Base에 남아 있는 USDC
- `solanaManagedAssets`: Solana 쪽 포트폴리오 가치
- `reservedRedemptionAssets`: 이미 redeem 요청되어 기존 share holder NAV에서 제외된 금액

즉 share 가격은 아래 기준으로 계산됩니다.

```text
activeAssets = baseIdleAssets + solanaManagedAssets - reservedRedemptionAssets
```

## Solana 측 구성

`solana/`는 Anchor 프로그램에 그대로 이식할 수 있는 포트폴리오 엔진 코어를 Rust로 구현합니다.

- 목표 비중 기반 초기 매수
- 가격 마킹
- 비중 기반 청산
- NAV 계산

현재는 외부 crate 없이 `cargo test` 가능한 형태로 두었고, 이후 Anchor instruction/account로 감싸면 됩니다.

## 실행 방법

### 1. Base 계약 빌드 및 테스트

```bash
cd /Users/taeho/Documents/New\ project/multichain-etf-poc/base
forge build
forge test
```

### 2. Solana 포트폴리오 엔진 테스트

```bash
cd /Users/taeho/Documents/New\ project/multichain-etf-poc/solana
cargo test
```

### 3. End-to-End 시뮬레이션

```bash
cd /Users/taeho/Documents/New\ project/multichain-etf-poc/simulator
node src/demo.mjs
```

### 4. Mock relayer 시나리오

```bash
cd /Users/taeho/Documents/New\ project/multichain-etf-poc/relayer
node src/demo-relayer.mjs
```

### 5. 브라우저 데모 실행

```bash
cd /Users/taeho/Documents/New\ project/multichain-etf-poc/frontend
node server.mjs
```

그 다음 브라우저에서 `http://localhost:4173` 를 열면 됩니다.

### 6. 실제 Base Sepolia 테스트

실제 지갑 연결과 testnet 트랜잭션 흐름은 [docs/base-sepolia-live.md](/Users/taeho/Documents/New project/multichain-etf-poc/docs/base-sepolia-live.md) 를 보면 됩니다.

요약하면:

1. `forge script` 로 `MockUSDC`, `MockBridge`, `Vault` 배포
2. 프론트 `Live Base Sepolia` 패널에 주소 입력
3. 지갑 연결 후 `Mint -> Approve -> Deposit`
4. owner 지갑으로 `Bridge -> NAV Sync -> Prepare Redemption -> Release -> Settle`

## 데모 시나리오

1. 사용자가 Base Vault에 `1000 USDC` deposit
2. Vault가 `1000 mETF` mint
3. 관리자 또는 relayer가 자산을 Solana로 bridge
4. Solana executor가 `40/30/30` 비중으로 자산 매수
5. 가격 상승 후 NAV를 Base Vault에 반영
6. 사용자가 일부 share redeem 요청
7. Solana에서 자산 일부 청산
8. USDC를 Base로 다시 bridge
9. Vault가 redeem settlement 완료

## 다음 단계

- 실제 Circle CCTP 또는 Wormhole 기반 브릿지 연결
- Anchor account/PDA treasury 적용
- Jupiter quote/CPI 연동
- oracle 또는 quote 기반 NAV 업데이트 자동화
- relayer 서비스와 관리자 키 분리
- Solana wallet adapter와 devnet executor 트랜잭션 연결

Anchor 형태로 옮길 때 참고할 초안은 [solana/anchor-program-template/README.md](/Users/taeho/Documents/New project/multichain-etf-poc/solana/anchor-program-template/README.md) 에 넣어 두었습니다.

세부 구조는 [docs/architecture.md](/Users/taeho/Documents/New project/multichain-etf-poc/docs/architecture.md) 에 정리해 두었습니다.
