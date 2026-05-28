# Base Sepolia Live Mode

이 문서는 실제 지갑을 연결해 Base Sepolia에서 테스트 트랜잭션을 실행하는 절차를 정리합니다.

## 네트워크

- Network: Base Sepolia
- Chain ID: `84532`
- RPC: `https://sepolia.base.org`
- Explorer: `https://sepolia-explorer.base.org`

## 준비물

- Base Sepolia를 지원하는 EVM 지갑
  예: Coinbase Wallet, MetaMask
- Base Sepolia ETH
  gas 용도
- Foundry

## 1. 계약 배포

배포 스크립트는 [DeployBaseSepolia.s.sol](/Users/taeho/Documents/New project/multichain-etf-poc/base/script/DeployBaseSepolia.s.sol) 입니다.

```bash
cd "/Users/taeho/Documents/New project/multichain-etf-poc/base"
export BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
export PRIVATE_KEY="0xYOUR_PRIVATE_KEY"

forge script script/DeployBaseSepolia.s.sol:DeployBaseSepolia \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast
```

배포가 끝나면 `MockUSDC`, `MockBridge`, `MultiChainETFVault` 주소를 기록해서 프론트에 넣으면 됩니다.

## 2. 프론트 실행

```bash
cd "/Users/taeho/Documents/New project/multichain-etf-poc/frontend"
node server.mjs
```

브라우저에서 `http://127.0.0.1:4173` 를 엽니다.

## 3. Live Testnet 패널 사용 순서

### 일반 사용자 흐름

1. `Connect Wallet`
2. `Switch Base Sepolia`
3. 계약 주소 3개 입력 후 `Save Addresses`
4. `Mint Test USDC`
5. `Approve USDC`
6. `Deposit To Vault`
7. 필요 시 `Request Redeem`

### 관리자 흐름

아래 작업은 Vault owner 또는 Bridge owner 지갑으로 연결해야 합니다.

1. `Bridge To Solana`
2. `Record Solana NAV`
3. `Prepare Redemption`
4. `Release From Bridge`
5. `Settle Redeem`

## 주의

- 현재 브릿지는 `MockBridge` 입니다.
- `MockUSDC.mint()` 는 누구나 호출 가능하게 열어 두었습니다.
- Solana 실제 스왑은 아직 mock relayer/수동 NAV sync 단계입니다.
- redeem 전체 흐름을 완료하려면 owner 권한 지갑이 필요합니다.
