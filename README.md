# OmniETF

블록체인 실무응용 팀 프로젝트입니다.

## 개요

OmniETF는 여러 체인에 분산된 자산 상태를 하나의 인덱스 토큰으로 묶는 멀티체인 ETF 구조를 구현합니다.

## 목표

- 멀티체인 자산 인덱싱
- 교환비 기반 토큰 발행
- CCIP 기반 크로스체인 상태 동기화
- 상환 흐름 검증

## 구성

- `contracts`: 스마트 컨트랙트 구현
- `scripts`: 배포 및 실행 스크립트
- `docs`: 설계 문서 및 발표 자료

## 발표 자료

- Slidev 원본: `slides.md`
- PPTX 출력: `OmniETF.pptx`
- PDF 출력: `OmniETF.pdf`

## Local demos

### EVM-only mock

```bash
npm install
npm run test:contracts
npm run demo:local
```

### Local EVM↔SVM PoC

```bash
npm run demo:cross-local
```

This starts Anvil, `solana-test-validator`, the native SVM portfolio program, the trusted local relayer, and the Vite UI. Open `http://localhost:5173`.

Stop background services:

```bash
npm run stop:local
```

Smoke test after local deployments are running:

```bash
npm run smoke:cross-local
```

See `docs/local-evm-svm.md` for details and trust-boundary notes.
