# Anchor Program Template

이 폴더는 현재 `solana/src/lib.rs`의 포트폴리오 엔진을 실제 Anchor instruction/account 구조로 감쌀 때 참고할 수 있는 스캐폴드입니다.

현재 환경에는 `anchor` CLI와 `anchor-lang` crate가 설치되어 있지 않아 여기서는 코드 생성과 구조 설계까지만 포함합니다.

## 목표 instruction

- `initialize_fund`
- `receive_bridged_usdc`
- `allocate_portfolio`
- `sync_prices`
- `prepare_redemption`
- `complete_rebalance`

## 권장 account 모델

- `FundState`
  포트폴리오 목표 비중, 관리자, 마지막 NAV, outstanding bridge action 저장
- `TreasuryPosition`
  종목별 수량 및 마지막 마크 가격 저장
- `TreasuryAuthority`
  PDA signer로 SPL treasury 관리

## 다음 단계

1. `anchor init` 또는 현재 폴더 기준으로 workspace 생성
2. `anchor-lang`, `anchor-spl` 의존성 추가
3. `solana/src/lib.rs`의 계산 로직을 instruction handler에서 호출
4. Jupiter CPI 또는 quote executor와 연결
5. Base relayer가 읽을 이벤트 형식 정의
