# Multi-Chain ETF PoC

> "자산 운용은 Solana, ETF 지분 관리는 Base"

Base 체인에서 ERC-4626 ETF Vault로 share를 관리하고, 실제 자산 운용(스왑·포트폴리오)은 Solana에서 수행하는 멀티체인 ETF PoC.

---

## 아키텍처

```
User (Base Chain)
       │
       │  deposit USDC
       ▼
 ┌─────────────┐     BridgeRequested event     ┌─────────────────────────┐
 │  ETFVault   │ ─────────────────────────────► │   Off-chain Coordinator │
 │  (ERC-4626) │                               │                         │
 │   mETF      │ ◄──────────────── NAV update ─┤  listens Base events    │
 └─────────────┘                               │  calls Solana program   │
       ▲                                       └────────────┬────────────┘
       │                                                    │
       │  completeRedeem (USDC back)                        │  execute_deposit /
       │                                                    │  execute_redeem
       │                                       ┌────────────▼────────────┐
 ┌─────────────┐                               │   Solana Program        │
 │  MockBridge │ ◄─────────────────────────── │   (Anchor)              │
 └─────────────┘    USDC settlement            │                         │
                                               │   TreasuryState PDA     │
                                               │   PortfolioConfig PDA   │
                                               │                         │
                                               │  mock swaps:            │
                                               │   USDC → AAPLx 40%     │
                                               │   USDC → TSLAx 30%     │
                                               │   USDC → NVDAx 30%     │
                                               └─────────────────────────┘
```

---

## 디렉토리 구조

```
contracts/              # Base chain (Hardhat + Solidity)
├── contracts/
│   ├── ETFVault.sol            # ERC-4626 Vault (핵심)
│   ├── MockUSDC.sol
│   ├── interfaces/
│   │   ├── IBridge.sol
│   │   └── INavOracle.sol
│   └── mocks/
│       ├── MockBridge.sol      # 이벤트 기반 브릿지 목
│       └── MockNavOracle.sol
└── test/ETFVault.test.ts       # 17개 테스트

programs/               # Solana (Anchor)
└── programs/etf-executor/src/
    ├── lib.rs                  # 진입점
    ├── instructions/
    │   ├── initialize.rs
    │   ├── execute_deposit.rs  # USDC → 포트폴리오
    │   ├── execute_redeem.rs   # 포트폴리오 → USDC
    │   ├── rebalance.rs        # 비중 재조정
    │   └── update_prices.rs   # Mock 가격 업데이트
    └── state/
        ├── treasury.rs         # TreasuryState PDA
        └── portfolio_config.rs # 비중/가격 설정

scripts/                # Off-chain 코디네이터
└── src/
    ├── coordinator.ts  # 이벤트 리스너 + Solana 실행
    └── demo.ts         # E2E 데모 시나리오
```

---

## 빠른 시작

### 1. Base Chain 테스트

```bash
cd contracts
npm install
npx hardhat test
```

결과: `17 passing`

### 2. E2E 데모

터미널 1 — Hardhat 로컬 노드:
```bash
cd contracts
npx hardhat node
```

터미널 2 — E2E 데모:
```bash
cd scripts
npm install
npx ts-node src/demo.ts
```

### 3. Solana 프로그램 배포 (devnet)

> Solana CLI + Anchor CLI 설치 필요

```bash
# Solana CLI 설치 (Mac/Linux)
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Anchor CLI 설치
npm install -g @coral-xyz/anchor-cli@0.30.1

# 빌드 및 테스트
cd programs
anchor build
anchor test
```

---

## 핵심 컨트랙트

### ETFVault.sol

| 함수 | 설명 |
|------|------|
| `deposit(assets, receiver)` | USDC 입금 → mETF 발행 → 브릿지 요청 |
| `redeem(shares, receiver, owner)` | mETF 소각 → 비동기 상환 등록 |
| `updateNAV(newNav)` | Oracle이 Solana NAV를 온체인에 기록 |
| `fulfillRedeem(redeemId)` | 브릿지가 USDC 지급 완료 시 호출 |
| `navPerShare()` | 현재 mETF 1주당 USDC 가치 |

### Solana TreasuryState PDA

| 필드 | 설명 |
|------|------|
| `aaplx_units / tslax_units / nvdax_units` | 보유 포지션 (6 decimals) |
| `total_shares` | Base 체인 발행 share 미러 |
| `nav_per_share` | 최신 NAV (coordinator가 Base에 보고) |

---

## 동작 플로우

### Deposit
```
1. User.deposit(1000 USDC)
2. Vault mints 1000 mETF shares
3. Vault emits BridgeRequested(depositId=1, 1000 USDC)
4. Coordinator picks up event
5. Coordinator calls Solana execute_deposit
   → 400 USDC → AAPLx (2.67 units at $150)
   → 300 USDC → TSLAx (1.50 units at $200)
   → 300 USDC → NVDAx (0.375 units at $800)
6. Coordinator calls MockNavOracle.reportNAV(~1000 USDC)
7. Vault.reportedNAV = 1000 USDC
```

### Redeem
```
1. User.redeem(500 mETF)
2. Vault burns 500 shares
3. Vault emits RedeemRequested(redeemId=1, 500 USDC expected)
4. Coordinator picks up event
5. Coordinator calls Solana execute_redeem(500 shares)
   → Solana sells 50% of each position
   → Returns ~500 USDC
6. Coordinator calls MockBridge.completeRedeem(user, 500 USDC)
7. Bridge transfers USDC to user
8. Bridge calls vault.fulfillRedeem(redeemId=1)
```

---

## 포트폴리오 설정

| 자산 | 비중 | 초기 가격 |
|------|------|-----------|
| AAPLx | 40% | $150.00 |
| TSLAx | 30% | $200.00 |
| NVDAx | 30% | $800.00 |

---

## 브릿지 / Production 전환

현재 `MockBridge`를 실제 브릿지로 교체하려면:

**Wormhole:**
```solidity
// IBridge.sol 구현체로 WormholeBridge.sol 작성
// IWormhole.publishMessage() 호출
```

**LayerZero:**
```solidity
// OApp 패턴으로 ETFVault가 OApp을 상속
// _lzSend()로 크로스체인 메시지 전송
```

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Base Chain | Solidity 0.8.28, ERC-4626, OpenZeppelin v5, Hardhat 2 |
| Solana | Rust, Anchor 0.30.1 |
| Bridge | MockBridge (PoC) → Wormhole/LayerZero (Production) |
| Off-chain | TypeScript, ethers.js v6 |
| 가격 피드 | Mock (PoC) → Pyth/Switchboard (Production) |

---

## 향후 확장

- [ ] 실제 Wormhole/LayerZero 브릿지 연동
- [ ] Pyth Oracle 실시간 가격 피드
- [ ] Jupiter Swap API로 실제 SPL token 스왑
- [ ] 자동 리밸런싱 트리거 (임계치 기반)
- [ ] AI 기반 동적 포트폴리오 비중 조정
- [ ] Cross-chain yield optimization
