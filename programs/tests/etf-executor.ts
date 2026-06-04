import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { EtfExecutor } from "../target/types/etf_executor";
import { expect } from "chai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function usdc(amount: number): BN {
  return new BN(amount * 1_000_000); // 6 decimals
}

function price(usdcValue: number): BN {
  return new BN(usdcValue * 1_000_000); // 6 decimals
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Mock initial prices: AAPL=$150, TSLA=$200, NVDA=$800
const AAPLX_PRICE = price(150);
const TSLAX_PRICE = price(200);
const NVDAX_PRICE = price(800);

// Target weights: 40% / 30% / 30%
const AAPLX_WEIGHT = 4000;
const TSLAX_WEIGHT = 3000;
const NVDAX_WEIGHT = 3000;

const BASE_VAULT_ADDRESS = Buffer.alloc(20, 1); // placeholder 0x0101...01

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("etf-executor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.EtfExecutor as Program<EtfExecutor>;
  const authority = provider.wallet as anchor.Wallet;

  // PDA addresses
  let treasuryPDA: anchor.web3.PublicKey;
  let configPDA: anchor.web3.PublicKey;

  before(async () => {
    [treasuryPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );
    [configPDA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("portfolio-config")],
      program.programId
    );
  });

  // ── initialize ─────────────────────────────────────────────────────────────

  describe("initialize", () => {
    it("creates treasury and portfolio config PDAs", async () => {
      await program.methods
        .initialize(
          [...BASE_VAULT_ADDRESS],
          AAPLX_WEIGHT,
          TSLAX_WEIGHT,
          NVDAX_WEIGHT,
          AAPLX_PRICE,
          TSLAX_PRICE,
          NVDAX_PRICE
        )
        .accounts({ authority: authority.publicKey })
        .rpc();

      const treasury = await program.account.treasuryState.fetch(treasuryPDA);
      expect(treasury.authority.toString()).to.equal(authority.publicKey.toString());
      expect(treasury.totalShares.toNumber()).to.equal(0);
      expect(treasury.navPerShare.toNumber()).to.equal(1_000_000); // 1.00 USDC

      const config = await program.account.portfolioConfig.fetch(configPDA);
      expect(config.aaplxWeightBps).to.equal(AAPLX_WEIGHT);
      expect(config.tslaxWeightBps).to.equal(TSLAX_WEIGHT);
      expect(config.nvdaxWeightBps).to.equal(NVDAX_WEIGHT);
    });

    it("rejects invalid weights (not summing to 10000)", async () => {
      try {
        await program.methods
          .initialize(
            [...BASE_VAULT_ADDRESS],
            5000, 3000, 3000, // 11000 total — invalid
            AAPLX_PRICE,
            TSLAX_PRICE,
            NVDAX_PRICE
          )
          .accounts({ authority: authority.publicKey })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error?.errorMessage || err.message).to.include("weights");
      }
    });
  });

  // ── execute_deposit ────────────────────────────────────────────────────────

  describe("execute_deposit", () => {
    it("swaps 1000 USDC into portfolio correctly", async () => {
      await program.methods
        .executeDeposit(
          usdc(1000),   // 1000 USDC
          new BN(1),    // deposit_id = 1
          usdc(1000)    // shares_minted = 1000 (1:1 on first deposit)
        )
        .accounts({ authority: authority.publicKey })
        .rpc();

      const treasury = await program.account.treasuryState.fetch(treasuryPDA);
      const config = await program.account.portfolioConfig.fetch(configPDA);

      // 40% of 1000 USDC at $150/AAPL = 2.666... AAPL ≈ 2_666_666 units (6 dec)
      const expectedAaplx = Math.floor(400 * 1_000_000 / 150);
      expect(treasury.aaplxUnits.toNumber()).to.be.approximately(expectedAaplx, 100);

      // 30% of 1000 USDC at $200/TSLA = 1.5 TSLA = 1_500_000 units
      const expectedTslax = Math.floor(300 * 1_000_000 / 200);
      expect(treasury.tslaxUnits.toNumber()).to.be.approximately(expectedTslax, 100);

      // 30% at $800/NVDA = 0.375 NVDA = 375_000 units
      const expectedNvdax = Math.floor(300 * 1_000_000 / 800);
      expect(treasury.nvdaxUnits.toNumber()).to.be.approximately(expectedNvdax, 100);

      expect(treasury.totalShares.toNumber()).to.equal(usdc(1000).toNumber());
      expect(treasury.depositCount.toNumber()).to.equal(1);

      // NAV should be ~1000 USDC
      const totalNav = treasury.navPerShare.toNumber() * treasury.totalShares.toNumber() / 1_000_000;
      expect(totalNav).to.be.approximately(1000 * 1_000_000, 10000);
    });

    it("increases portfolio on second deposit", async () => {
      await program.methods
        .executeDeposit(usdc(500), new BN(2), usdc(500))
        .accounts({ authority: authority.publicKey })
        .rpc();

      const treasury = await program.account.treasuryState.fetch(treasuryPDA);
      expect(treasury.totalShares.toNumber()).to.equal(usdc(1500).toNumber());
    });
  });

  // ── execute_redeem ─────────────────────────────────────────────────────────

  describe("execute_redeem", () => {
    it("redeems 500 shares proportionally", async () => {
      const treasuryBefore = await program.account.treasuryState.fetch(treasuryPDA);
      const sharesBefore = treasuryBefore.totalShares.toNumber();
      const aaplxBefore = treasuryBefore.aaplxUnits.toNumber();

      await program.methods
        .executeRedeem(usdc(500), new BN(1))
        .accounts({ authority: authority.publicKey })
        .rpc();

      const treasury = await program.account.treasuryState.fetch(treasuryPDA);
      expect(treasury.totalShares.toNumber()).to.equal(sharesBefore - usdc(500).toNumber());
      // AAPLx should decrease by ~1/3 (500/1500 shares)
      expect(treasury.aaplxUnits.toNumber()).to.be.approximately(
        Math.floor(aaplxBefore * (2/3)), 100
      );
      expect(treasury.redeemCount.toNumber()).to.equal(1);
    });
  });

  // ── rebalance ──────────────────────────────────────────────────────────────

  describe("rebalance", () => {
    it("rebalances to new weights 50/25/25", async () => {
      await program.methods
        .rebalance(
          5000, 2500, 2500,
          new BN(0), new BN(0), new BN(0) // keep prices
        )
        .accounts({ authority: authority.publicKey })
        .rpc();

      const config = await program.account.portfolioConfig.fetch(configPDA);
      expect(config.aaplxWeightBps).to.equal(5000);
      expect(config.tslaxWeightBps).to.equal(2500);
    });

    it("rebalances with price update", async () => {
      // AAPL price doubles to $300
      await program.methods
        .rebalance(
          4000, 3000, 3000, // back to original weights
          price(300), new BN(0), new BN(0)
        )
        .accounts({ authority: authority.publicKey })
        .rpc();

      const config = await program.account.portfolioConfig.fetch(configPDA);
      expect(config.aaplxPriceUsdc.toNumber()).to.equal(price(300).toNumber());

      // NAV should increase because AAPL price doubled
      const treasury = await program.account.treasuryState.fetch(treasuryPDA);
      expect(treasury.navPerShare.toNumber()).to.be.greaterThan(1_000_000);
    });
  });

  // ── update_prices ──────────────────────────────────────────────────────────

  describe("update_prices", () => {
    it("updates prices and recalculates NAV", async () => {
      const before = await program.account.treasuryState.fetch(treasuryPDA);
      const navBefore = before.navPerShare.toNumber();

      // All prices go to half
      await program.methods
        .updatePrices(price(75), price(100), price(400))
        .accounts({ authority: authority.publicKey })
        .rpc();

      const after = await program.account.treasuryState.fetch(treasuryPDA);
      expect(after.navPerShare.toNumber()).to.be.lessThan(navBefore);
    });
  });
});
