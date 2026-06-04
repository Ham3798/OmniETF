// Shared types for the off-chain coordinator and demo

export interface ContractAddresses {
  mockUSDC: string;
  mockBridge: string;
  mockNavOracle: string;
  etfVault: string;
}

export interface SolanaConfig {
  rpcUrl: string;
  programId: string;
  walletKeypairPath: string;
}

export interface PortfolioState {
  aaplxUnits: bigint;
  tslaxUnits: bigint;
  nvdaxUnits: bigint;
  totalShares: bigint;
  navPerShare: bigint;
  totalUsdcDeployed: bigint;
}

export interface AssetPrices {
  aaplx: bigint; // USDC, 6 decimals
  tslax: bigint;
  nvdax: bigint;
}

export interface PendingDeposit {
  depositId: bigint;
  usdcAmount: bigint;
  sharesMinted: bigint;
  timestamp: number;
}

export interface PendingRedeem {
  redeemId: bigint;
  user: string;
  shares: bigint;
  usdcExpected: bigint;
  timestamp: number;
}

// Default mock prices for demo
export const DEFAULT_PRICES: AssetPrices = {
  aaplx: BigInt(150_000_000),  // $150.00
  tslax: BigInt(200_000_000),  // $200.00
  nvdax: BigInt(800_000_000),  // $800.00
};

// Default portfolio weights (bps)
export const DEFAULT_WEIGHTS = {
  aaplx: 4000, // 40%
  tslax: 3000, // 30%
  nvdax: 3000, // 30%
};
