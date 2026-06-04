import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ETFVault, MockUSDC, MockBridge, MockNavOracle } from "../typechain-types";

describe("ETFVault", function () {
  async function deployFixture() {
    const [owner, user, coordinator] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = (await USDC.deploy()) as MockUSDC;

    const Bridge = await ethers.getContractFactory("MockBridge");
    const bridge = (await Bridge.deploy(await usdc.getAddress())) as MockBridge;

    const Oracle = await ethers.getContractFactory("MockNavOracle");
    const oracle = (await Oracle.deploy()) as MockNavOracle;

    const solanaTreasury = ethers.zeroPadBytes("0x01", 32);
    const Vault = await ethers.getContractFactory("ETFVault");
    const vault = (await Vault.deploy(
      await usdc.getAddress(),
      await bridge.getAddress(),
      await oracle.getAddress(),
      solanaTreasury
    )) as ETFVault;

    await bridge.setVault(await vault.getAddress());

    // Fund bridge to simulate Solana → Base paybacks
    await usdc.mint(await bridge.getAddress(), ethers.parseUnits("1000000", 6));

    // Give user USDC
    await usdc.mint(user.address, ethers.parseUnits("10000", 6));

    // Allow coordinator as NAV reporter
    await oracle.setReporter(coordinator.address, true);

    return { vault, usdc, bridge, oracle, owner, user, coordinator };
  }

  describe("Deployment", function () {
    it("sets correct asset (USDC)", async function () {
      const { vault, usdc } = await loadFixture(deployFixture);
      expect(await vault.asset()).to.equal(await usdc.getAddress());
    });

    it("has zero initial totalAssets", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.totalAssets()).to.equal(0);
    });

    it("mints no initial shares", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.totalSupply()).to.equal(0);
    });
  });

  describe("Deposit", function () {
    it("mints correct shares on first deposit (1:1 with USDC)", async function () {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), amount);
      await vault.connect(user).deposit(amount, user.address);

      expect(await vault.balanceOf(user.address)).to.equal(amount);
    });

    it("emits DepositBridged event", async function () {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), amount);
      await expect(vault.connect(user).deposit(amount, user.address))
        .to.emit(vault, "DepositBridged")
        .withArgs(1, user.address, amount, amount);
    });

    it("emits BridgeRequested from MockBridge", async function () {
      const { vault, usdc, bridge, user } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), amount);
      await expect(vault.connect(user).deposit(amount, user.address))
        .to.emit(bridge, "BridgeRequested")
        .withArgs(1, await vault.getAddress(), amount, ethers.zeroPadBytes("0x01", 32));
    });

    it("increments depositNonce", async function () {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), amount * 2n);
      await vault.connect(user).deposit(amount, user.address);
      await vault.connect(user).deposit(amount, user.address);

      expect(await vault.depositNonce()).to.equal(2);
    });

    it("updates reportedNAV by deposit amount", async function () {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), amount);
      await vault.connect(user).deposit(amount, user.address);

      expect(await vault.reportedNAV()).to.equal(amount);
    });
  });

  describe("NAV Update", function () {
    it("oracle can update NAV", async function () {
      const { vault, usdc, oracle, user, coordinator } = await loadFixture(deployFixture);
      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(depositAmount, user.address);

      // Simulate Solana portfolio gained 5%
      const newNAV = ethers.parseUnits("1050", 6);
      await oracle.connect(coordinator).reportNAV(await vault.getAddress(), newNAV);

      expect(await vault.totalAssets()).to.equal(newNAV);
    });

    it("non-oracle cannot update NAV", async function () {
      const { vault, user } = await loadFixture(deployFixture);
      await expect(vault.connect(user).updateNAV(1000n))
        .to.be.revertedWithCustomError(vault, "OnlyOracle");
    });

    it("NAV update changes share price", async function () {
      const { vault, usdc, oracle, user, coordinator } = await loadFixture(deployFixture);
      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(depositAmount, user.address);

      // NAV doubles (100% gain)
      const newNAV = ethers.parseUnits("2000", 6);
      await oracle.connect(coordinator).reportNAV(await vault.getAddress(), newNAV);

      // Second depositor should get half shares for same USDC
      const [user2] = (await ethers.getSigners()).slice(3);
      await usdc.mint(user2.address, ethers.parseUnits("1000", 6));
      await usdc.connect(user2).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user2).deposit(depositAmount, user2.address);

      // user2 paid 1000 USDC, NAV was 2000 with 1000 shares → gets 500 shares
      expect(await vault.balanceOf(user2.address)).to.equal(ethers.parseUnits("500", 6));
    });
  });

  describe("Redeem", function () {
    it("registers pending redeem on redeem()", async function () {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(depositAmount, user.address);

      const shares = await vault.balanceOf(user.address);
      await vault.connect(user).redeem(shares, user.address, user.address);

      const pr = await vault.getPendingRedeem(1);
      expect(pr.user).to.equal(user.address);
      expect(pr.shares).to.equal(shares);
      expect(pr.fulfilled).to.be.false;
    });

    it("emits RedeemRequested event", async function () {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(depositAmount, user.address);

      const shares = await vault.balanceOf(user.address);
      await expect(vault.connect(user).redeem(shares, user.address, user.address))
        .to.emit(vault, "RedeemRequested");
    });

    it("burns shares on redeem()", async function () {
      const { vault, usdc, user } = await loadFixture(deployFixture);
      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(depositAmount, user.address);

      const shares = await vault.balanceOf(user.address);
      await vault.connect(user).redeem(shares, user.address, user.address);

      expect(await vault.balanceOf(user.address)).to.equal(0);
    });

    it("fulfillRedeem marks pending as fulfilled", async function () {
      const { vault, usdc, bridge, user, owner } = await loadFixture(deployFixture);
      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(depositAmount, user.address);

      const shares = await vault.balanceOf(user.address);
      await vault.connect(user).redeem(shares, user.address, user.address);

      // Coordinator calls completeRedeem on bridge, which calls vault.fulfillRedeem
      const pr = await vault.getPendingRedeem(1);
      await bridge.connect(owner).completeRedeem(pr.user, pr.usdcExpected, 1);

      const fulfilled = await vault.getPendingRedeem(1);
      expect(fulfilled.fulfilled).to.be.true;
    });
  });

  describe("navPerShare()", function () {
    it("returns 1e6 when no shares minted", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.navPerShare()).to.equal(1_000_000n);
    });

    it("reflects NAV growth", async function () {
      const { vault, usdc, oracle, user, coordinator } = await loadFixture(deployFixture);
      const depositAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
      await vault.connect(user).deposit(depositAmount, user.address);

      // 50% portfolio gain
      await oracle.connect(coordinator).reportNAV(await vault.getAddress(), ethers.parseUnits("1500", 6));

      // navPerShare = 1500e6 * 1e18 / 1000e6 = 1.5e18 (in 1e18 units)
      const nps = await vault.navPerShare();
      expect(nps).to.equal(ethers.parseUnits("1.5", 18));
    });
  });
});
