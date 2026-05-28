# 블실응 정리

---

# 멀티체인 ETF PoC 계획서

## 개요

본 프로젝트는 **멀티체인 기반 ETF 구조**를 블록체인 상에서 간단한 PoC(Proof of Concept) 형태로 구현하는 것을 목표로 한다.

사용자는 Base 체인에서 ETF Share Token을 발급받지만, 실제 기초자산 운용 및 스왑은 솔라나에서 수행된다.

핵심 아이디어는 다음과 같다.

- ETF의 “지분(share)”은 EVM 체인(Base)에서 관리
- 실제 자산 매매 및 유동성 활용은 솔라나에서 수행
- 브릿지를 통해 체인 간 자산 이동
- ERC-4626 Vault 구조를 활용하여 ETF share 발행/상환 처리

즉,

> “자산 운용은 솔라나, ETF 지분 관리는 Base”
> 

라는 구조를 실험하는 프로젝트이다.

---

# 프로젝트 목표

## 목표

- ERC-4626 기반 ETF Vault 구현
- 멀티체인 자산 운용 구조 실험
- Base ↔ Solana 간 브릿지 흐름 검증
- ETF Share mint/redeem 메커니즘 구현
- 해커톤 수준의 End-to-End PoC 완성

## 핵심 컨셉

사용자는 Base 체인에서 단순히 ETF를 구매하지만,

실제 내부에서는:

1. 자산 브릿징
2. 솔라나 내 스왑
3. 포트폴리오 리밸런싱
4. ETF NAV 계산

등이 수행된다.

---

# 시스템 구조

## 아키텍처

```
User
 │
 ▼
Base Chain
(ERC4626 ETF Vault)
 │
 │ Deposit USDC
 ▼
Bridge
(Base → Solana)
 │
 ▼
Solana Executor
 │
 ├─ Swap to AAPLx
 ├─ Swap to TSLAx
 ├─ Swap to NVDAx
 │
 ▼
Portfolio Treasury
```

---

# 동작 플로우

## 1. Deposit Flow

사용자가 Base 체인 ETF Vault에 USDC를 deposit

### 과정

```
User
 → deposit(USDC)
 → ERC4626 Vault
 → ETF Share mint
 → Bridge to Solana
 → Solana Executor swaps assets
 → Portfolio 구성
```

### 상세

1. 사용자가 Base 체인에 USDC deposit
2. Vault가 ETF share token 발행
3. USDC를 Solana로 브릿지
4. 솔라나에서 비율 기반 스왑 수행

예시:

| 자산 | 비율 |
| --- | --- |
| AAPLx | 40% |
| TSLAx | 30% |
| NVDAx | 30% |
1. 솔라나 treasury가 자산 보관

---

# 2. Redeem Flow

사용자가 ETF Share를 redeem 요청

### 과정

```
User
 → redeem(shares)
 → Vault
 → Solana assets sell
 → USDC bridge back
 → Base payout
```

### 상세

1. 사용자가 ETF share 반환
2. 솔라나 executor가 비율대로 자산 매도
3. USDC로 변환
4. Base 체인으로 브릿지
5. 사용자에게 지급

---

# 브릿지 사용 여부에 따른 구조

## 구조 A — 브릿지 기반

### 특징

- ETF Share는 Base 체인 존재
- 실제 자산은 Solana 존재
- Cross-chain accounting 필요

### 장점

- EVM UX 활용 가능
- Base 생태계 사용자 접근성
- Vault/DeFi composability 활용 가능

### 단점

- 브릿지 리스크
- Cross-chain sync 필요
- redeem latency 발생

---

## 구조 B — Solana Native

### 특징

- ETF Share까지 Solana에서 처리
- 브릿지 제거

### 장점

- 단순한 구조
- 빠른 체결
- 브릿지 리스크 감소

### 단점

- EVM 사용자 접근성 감소
- ERC4626 composability 제거

---

# 기술 스택

## Base Side

- Solidity
- ERC-4626 Vault
- OpenZeppelin
- Foundry

## Solana Side

- Anchor
- Jupiter Swap API
- SPL Token
- PDA Treasury

## Bridge

후보:

- LayerZero
- Wormhole
- Hyperlane

PoC 기준으로는 구현 단순성을 위해 Wormhole 또는 LayerZero 고려

---

# ETF Share 구조

## Share Token

ERC4626 기반 share token

예시:

```
mETF
```

사용자는:

- deposit → mETF mint
- redeem → underlying value claim

---

# NAV 계산

## 방식

솔라나 treasury의 현재 가치 기준

```
NAV =
(AAPLx value
 + TSLAx value
 + NVDAx value)
 / totalShares
```

가격은:

- Oracle
- Jupiter Quote
- 외부 Price API

등을 활용 가능

---

# 리밸런싱

## 단순 PoC 버전

수동 rebalance

```
관리자 호출:
rebalance()
```

### 예시

기존:

| 자산 | 비율 |
| --- | --- |
| AAPLx | 70% |
| TSLAx | 20% |
| NVDAx | 10% |

목표:

| 자산 | 비율 |
| --- | --- |
| AAPLx | 40% |
| TSLAx | 30% |
| NVDAx | 30% |

→ 솔라나에서 swap 실행

---

# 핵심 연구 포인트

## 1. Cross-chain ETF 가능성

전통 ETF와 달리:

- 운용 체인
- 사용자 체인
- 결제 체인

이 분리될 수 있는가?

---

## 2. 브릿지 기반 자산 운용

브릿지가 단순 전송이 아니라:

- ETF settlement layer
- portfolio transport layer

역할 가능 여부

---

## 3. 체인별 역할 분리

### Base

- 사용자 인터페이스
- share accounting
- vault logic

### Solana

- execution
- low latency swaps
- liquidity access

---

# 예상 구현 범위 (해커톤 PoC)

## MVP

### 구현

- ERC4626 Vault
- deposit/redeem
- bridge mock
- Solana swap executor
- NAV calculation

### 생략 가능

- 완전 자동 리밸런싱
- 실시간 oracle
- permissionless 구조
- 완전 trustless bridge

---

# 예상 데모 시나리오

## 시연

1. 사용자 USDC deposit
2. ETF share mint
3. 솔라나에서 stock token swap
4. 포트폴리오 상태 표시
5. redeem 요청
6. 자산 매도 후 USDC 반환

---

# 향후 확장 가능성

## 확장 아이디어

- AI 기반 동적 포트폴리오
- 온체인 인덱스 펀드
- 실시간 리밸런싱
- Perp 기반 synthetic ETF
- Multi-chain treasury routing
- Cross-chain yield optimization

---

# 결론

본 프로젝트는 단순 ETF 구현보다:

> “운용 체인과 사용자 체인을 분리할 수 있는가?”
> 

를 실험하는 멀티체인 자산 운용 PoC에 가깝다.

특히:

- EVM의 자산 관리 UX
- Solana의 빠른 실행 환경
- 브릿지 기반 settlement

를 결합하여

차세대 온체인 ETF 구조를 실험하는 것이 핵심 목표이다.