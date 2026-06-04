/**
 * Off-chain coordinator: bridges events between Base chain and Solana.
 *
 * Production flow:
 *   BridgeRequested (Base)  → execute_deposit  (Solana)
 *   RedeemRequested (Base)  → execute_redeem   (Solana) → completeRedeem (Base)
 *   Every 30s              → updatePrices / report NAV  (Solana → Base)
 *
 * For the PoC, Solana interactions are simulated via mock state objects
 * so the coordinator can run without a live Solana validator.
 */

import { ethers } from "ethers";
import { PortfolioState, AssetPrices, DEFAULT_PRICES, DEFAULT_WEIGHTS } from "./types";

// ─── ABI snippets (minimal, for PoC) ─────────────────────────────────────────

const BRIDGE_ABI = [
  "event BridgeRequested(uint256 indexed depositId, address indexed sender, uint256 amount, bytes32 solanaRecipient)",
  "event RedeemCompleted(uint256 indexed redeemId, address indexed user, uint256 usdcAmount)",
  "function completeRedeem(address user, uint256 usdcAmount, uint256 redeemId) external",
];

const VAULT_ABI = [
  "event RedeemRequested(uint256 indexed redeemId, address indexed user, uint256 shares, uint256 usdcExpected)",
  "function getPendingRedeem(uint256 redeemId) external view returns (tuple(address user, uint256 shares, uint256 usdcExpected, bool fulfilled))",
  "function totalSupply() external view returns (uint256)",
];

const ORACLE_ABI = [
  "function reportNAV(address vault, uint256 navValue) external",
];

// ─── MockSolanaExecutor ───────────────────────────────────────────────────────
// Simulates the Solana program state locally for the PoC demo.
// Replace with actual @coral-xyz/anchor calls when deploying to devnet.

export class MockSolanaExecutor {
  private state: PortfolioState = {
    aaplxUnits: 0n,
    tslaxUnits: 0n,
    nvdaxUnits: 0n,
    totalShares: 0n,
    navPerShare: 1_000_000n,
    totalUsdcDeployed: 0n,
  };
  private prices: AssetPrices = { ...DEFAULT_PRICES };

  executeDeposit(usdcAmount: bigint, _depositId: bigint, sharesMinted: bigint): void {
    const aaplxUsdc = (usdcAmount * BigInt(DEFAULT_WEIGHTS.aaplx)) / 10_000n;
    const tslaxUsdc = (usdcAmount * BigInt(DEFAULT_WEIGHTS.tslax)) / 10_000n;
    const nvdaxUsdc = usdcAmount - aaplxUsdc - tslaxUsdc;

    this.state.aaplxUnits += (aaplxUsdc * 1_000_000n) / this.prices.aaplx;
    this.state.tslaxUnits += (tslaxUsdc * 1_000_000n) / this.prices.tslax;
    this.state.nvdaxUnits += (nvdaxUsdc * 1_000_000n) / this.prices.nvdax;
    this.state.totalShares += sharesMinted;
    this.state.totalUsdcDeployed += usdcAmount;
    this.updateNAV();

    console.log(`  [Solana] executeDeposit: ${usdcAmount / 1_000_000n} USDC → portfolio`);
    this.logPortfolio();
  }

  executeRedeem(sharesToRedeem: bigint, _redeemId: bigint): bigint {
    if (this.state.totalShares === 0n) return 0n;

    const portfolioUsdc = this.calcPortfolioUsdc();
    const usdcOut = (portfolioUsdc * sharesToRedeem) / this.state.totalShares;

    this.state.aaplxUnits -= (this.state.aaplxUnits * sharesToRedeem) / this.state.totalShares;
    this.state.tslaxUnits -= (this.state.tslaxUnits * sharesToRedeem) / this.state.totalShares;
    this.state.nvdaxUnits -= (this.state.nvdaxUnits * sharesToRedeem) / this.state.totalShares;
    this.state.totalShares -= sharesToRedeem;
    this.updateNAV();

    console.log(`  [Solana] executeRedeem: ${sharesToRedeem / 1_000_000n} shares → ${usdcOut / 1_000_000n} USDC`);
    return usdcOut;
  }

  getPortfolioUsdc(): bigint {
    return this.calcPortfolioUsdc();
  }

  getTotalShares(): bigint {
    return this.state.totalShares;
  }

  getNavPerShare(): bigint {
    return this.state.navPerShare;
  }

  updatePrices(newPrices: AssetPrices): void {
    this.prices = newPrices;
    this.updateNAV();
  }

  private calcPortfolioUsdc(): bigint {
    return (
      (this.state.aaplxUnits * this.prices.aaplx) / 1_000_000n +
      (this.state.tslaxUnits * this.prices.tslax) / 1_000_000n +
      (this.state.nvdaxUnits * this.prices.nvdax) / 1_000_000n
    );
  }

  private updateNAV(): void {
    if (this.state.totalShares > 0n) {
      this.state.navPerShare = (this.calcPortfolioUsdc() * 1_000_000n) / this.state.totalShares;
    } else {
      this.state.navPerShare = 1_000_000n;
    }
  }

  logPortfolio(): void {
    const pUsdc = this.calcPortfolioUsdc();
    console.log(`    Portfolio total : ${Number(pUsdc) / 1e6} USDC`);
    console.log(`    AAPLx           : ${Number(this.state.aaplxUnits) / 1e6} units`);
    console.log(`    TSLAx           : ${Number(this.state.tslaxUnits) / 1e6} units`);
    console.log(`    NVDAx           : ${Number(this.state.nvdaxUnits) / 1e6} units`);
    console.log(`    NAV/share       : ${Number(this.state.navPerShare) / 1e6} USDC`);
  }
}

// ─── Coordinator ─────────────────────────────────────────────────────────────

export class Coordinator {
  public readonly solana: MockSolanaExecutor;
  private bridge: ethers.Contract;
  private vault: ethers.Contract;
  private oracle: ethers.Contract;
  private signer: ethers.Signer;
  private navInterval: NodeJS.Timeout | null = null;

  constructor(
    provider: ethers.JsonRpcProvider,
    signer: ethers.Signer,
    bridgeAddress: string,
    vaultAddress: string,
    oracleAddress: string
  ) {
    this.signer = signer;
    this.bridge = new ethers.Contract(bridgeAddress, BRIDGE_ABI, signer);
    this.vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
    this.oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, signer);
    this.solana = new MockSolanaExecutor();
  }

  // ── Direct call API (used by demo script for deterministic control) ─────────

  /** Process a deposit: update Solana state then push NAV to Base. */
  async processDeposit(usdcAmount: bigint, depositId: bigint, sharesMinted: bigint): Promise<void> {
    this.solana.executeDeposit(usdcAmount, depositId, sharesMinted);
    await this.reportNAV();
  }

  /** Process a redeem: sell on Solana then complete the bridge back to Base. */
  async processRedeem(shares: bigint, redeemId: bigint, userAddress: string): Promise<bigint> {
    const usdcOut = this.solana.executeRedeem(shares, redeemId);
    console.log(`  [Solana→Bridge] Sending ${usdcOut / 1_000_000n} USDC back to ${userAddress}`);
    const tx = await this.bridge.completeRedeem(userAddress, usdcOut, redeemId);
    await tx.wait();
    console.log(`  [Bridge] Redeem #${redeemId} completed`);
    await this.reportNAV();
    return usdcOut;
  }

  // ── Event-based API (for production / standalone coordinator process) ───────

  async startListening(): Promise<void> {
    console.log("[Coordinator] Starting event listeners...");

    this.bridge.on("BridgeRequested", async (...args: any[]) => {
      const event = args[args.length - 1];
      const [depositId, , amount] = event.args ?? args;
      console.log(`\n[Bridge→Solana] Deposit #${depositId}: ${BigInt(amount) / 1_000_000n} USDC bridged`);
      const totalShares = await this.vault.totalSupply();
      await this.processDeposit(BigInt(amount), BigInt(depositId), BigInt(totalShares));
    });

    this.vault.on("RedeemRequested", async (...args: any[]) => {
      const event = args[args.length - 1];
      const [redeemId, user, shares] = event.args ?? args;
      console.log(`\n[Vault→Solana] Redeem #${redeemId}: ${BigInt(shares) / 1_000_000n} shares from ${user}`);
      await this.processRedeem(BigInt(shares), BigInt(redeemId), user);
    });

    this.navInterval = setInterval(() => this.reportNAV(), 30_000);
    console.log("[Coordinator] Listening for events...");
  }

  async stop(): Promise<void> {
    if (this.navInterval) clearInterval(this.navInterval);
    this.bridge.removeAllListeners();
    this.vault.removeAllListeners();
    console.log("[Coordinator] Stopped.");
  }

  async reportNAV(): Promise<void> {
    const portfolioUsdc = this.solana.getPortfolioUsdc();
    const vaultAddress = await this.vault.getAddress();
    try {
      const tx = await this.oracle.reportNAV(vaultAddress, portfolioUsdc);
      await tx.wait();
      console.log(`  [Oracle] NAV updated: ${portfolioUsdc / 1_000_000n} USDC`);
    } catch (err) {
      console.error(`  [Oracle] NAV report failed: ${err}`);
    }
  }

  async simulatePriceChange(newPrices: AssetPrices): Promise<void> {
    console.log("\n[Demo] Simulating price change...");
    this.solana.updatePrices(newPrices);
    console.log("  Updated prices: AAPLx $" + Number(newPrices.aaplx) / 1e6 +
                " | TSLAx $" + Number(newPrices.tslax) / 1e6 +
                " | NVDAx $" + Number(newPrices.nvdax) / 1e6);
    this.solana.logPortfolio();
    await this.reportNAV();
  }
}
