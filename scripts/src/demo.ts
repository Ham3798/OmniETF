/**
 * E2E Demo — Multi-chain ETF PoC
 *
 * 1. Deploy contracts to local Hardhat node
 * 2. User deposits 1000 USDC → mETF shares minted → Solana swaps into portfolio
 * 3. Portfolio gains 20% (price simulation)
 * 4. Second deposit 500 USDC (at higher NAV → fewer shares)
 * 5. User redeems 50% of shares → receives USDC back (with gain)
 *
 * Usage:
 *   # Terminal 1:
 *   cd contracts && npx hardhat node
 *   # Terminal 2:
 *   cd scripts && npx ts-node src/demo.ts
 */

import { ethers } from "ethers";
import { Coordinator } from "./coordinator";
import { AssetPrices } from "./types";

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const USDC_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
];

const VAULT_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function navPerShare() external view returns (uint256)",
  "function reportedNAV() external view returns (uint256)",
  "event RedeemRequested(uint256 indexed redeemId, address indexed user, uint256 shares, uint256 usdcExpected)",
];

const BRIDGE_ABI = [
  "function setVault(address vault) external",
];

const ORACLE_ABI = [
  "function setReporter(address reporter, bool trusted) external",
];

// ─── Deploy ───────────────────────────────────────────────────────────────────

async function deployContracts(deployer: ethers.Signer) {
  console.log("=== Deploying Contracts ===\n");

  const artifacts = {
    MockUSDC: require("../../contracts/artifacts/contracts/MockUSDC.sol/MockUSDC.json"),
    MockBridge: require("../../contracts/artifacts/contracts/mocks/MockBridge.sol/MockBridge.json"),
    MockNavOracle: require("../../contracts/artifacts/contracts/mocks/MockNavOracle.sol/MockNavOracle.json"),
    ETFVault: require("../../contracts/artifacts/contracts/ETFVault.sol/ETFVault.json"),
  };

  const usdcF = new ethers.ContractFactory(artifacts.MockUSDC.abi, artifacts.MockUSDC.bytecode, deployer);
  const usdc = await (await usdcF.deploy()).waitForDeployment();

  const bridgeF = new ethers.ContractFactory(artifacts.MockBridge.abi, artifacts.MockBridge.bytecode, deployer);
  const bridge = await (await bridgeF.deploy(await usdc.getAddress())).waitForDeployment();

  const oracleF = new ethers.ContractFactory(artifacts.MockNavOracle.abi, artifacts.MockNavOracle.bytecode, deployer);
  const oracle = await (await oracleF.deploy()).waitForDeployment();

  const solanaTreasury = ethers.zeroPadBytes("0x01", 32);
  const vaultF = new ethers.ContractFactory(artifacts.ETFVault.abi, artifacts.ETFVault.bytecode, deployer);
  const vault = await (await vaultF.deploy(
    await usdc.getAddress(),
    await bridge.getAddress(),
    await oracle.getAddress(),
    solanaTreasury,
  )).waitForDeployment();

  console.log("MockUSDC      :", await usdc.getAddress());
  console.log("MockBridge    :", await bridge.getAddress());
  console.log("MockNavOracle :", await oracle.getAddress());
  console.log("ETFVault      :", await vault.getAddress());

  // Wire bridge ↔ vault
  await (await new ethers.Contract(await bridge.getAddress(), BRIDGE_ABI, deployer)
    .setVault(await vault.getAddress())).wait();

  // Fund bridge (simulates Solana-side USDC pool for redemptions)
  const usdcC = new ethers.Contract(await usdc.getAddress(), USDC_ABI, deployer);
  await (await usdcC.mint(await bridge.getAddress(), ethers.parseUnits("1000000", 6))).wait();

  // Allow deployer (coordinator) to report NAV
  await (await new ethers.Contract(await oracle.getAddress(), ORACLE_ABI, deployer)
    .setReporter(await deployer.getAddress(), true)).wait();

  return {
    usdc: new ethers.Contract(await usdc.getAddress(), USDC_ABI, deployer),
    vault: new ethers.Contract(await vault.getAddress(), VAULT_ABI, deployer),
    bridgeAddress: await bridge.getAddress(),
    oracleAddress: await oracle.getAddress(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount: bigint | number, decimals = 6): string {
  return (Number(amount) / 10 ** decimals).toFixed(2);
}

async function printStatus(vault: ethers.Contract, userAddress: string, label: string) {
  const shares = await vault.balanceOf(userAddress);
  const nav = await vault.reportedNAV();
  const nps = await vault.navPerShare();
  const supply = await vault.totalSupply();
  console.log(`\n┌─ ${label}`);
  console.log(`│  mETF shares (user)  : ${fmt(shares)}`);
  console.log(`│  Total supply        : ${fmt(supply)}`);
  console.log(`│  Reported NAV (USDC) : ${fmt(nav)}`);
  console.log(`└  NAV per share       : ${(Number(nps) / 1e18).toFixed(4)} USDC`);
}

// Parse RedeemRequested from receipt
function parseRedeemId(receipt: ethers.TransactionReceipt): bigint {
  for (const log of receipt.logs) {
    try {
      const iface = new ethers.Interface([
        "event RedeemRequested(uint256 indexed redeemId, address indexed user, uint256 shares, uint256 usdcExpected)"
      ]);
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed) return BigInt(parsed.args[0]);
    } catch {}
  }
  throw new Error("RedeemRequested event not found");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const accounts = await provider.listAccounts();
  const deployer = await provider.getSigner(accounts[0].address);
  const user = await provider.getSigner(accounts[1].address);
  const userAddr = await user.getAddress();

  // ── Step 1: Deploy ───────────────────────────────────────────────────────────
  const { usdc, vault, bridgeAddress, oracleAddress } = await deployContracts(deployer);

  // ── Step 2: Setup coordinator ────────────────────────────────────────────────
  const coordinator = new Coordinator(
    provider, deployer,
    bridgeAddress, await vault.getAddress(), oracleAddress
  );
  // (demo uses direct-call API, not event listeners)

  // Give user 2000 USDC
  await (await usdc.mint(userAddr, ethers.parseUnits("2000", 6))).wait();

  const userVault = new ethers.Contract(await vault.getAddress(), VAULT_ABI, user);
  const userUsdc = new ethers.Contract(await usdc.getAddress(), USDC_ABI, user);

  console.log(`\nUser USDC balance: ${fmt(await usdc.balanceOf(userAddr))} USDC`);

  // ── Step 3: Deposit 1000 USDC ────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════");
  console.log("  Step 3 — User deposits 1000 USDC");
  console.log("════════════════════════════════════════");

  await (await userUsdc.approve(await vault.getAddress(), ethers.parseUnits("1000", 6))).wait();
  const deposit1Tx = await userVault.deposit(ethers.parseUnits("1000", 6), userAddr);
  await deposit1Tx.wait();

  // Coordinator processes: Solana swaps USDC into portfolio, reports NAV
  const shares1 = await vault.totalSupply();
  await coordinator.processDeposit(ethers.parseUnits("1000", 6), 1n, BigInt(shares1));

  await printStatus(userVault, userAddr, "After Deposit");

  // ── Step 4: Price appreciation +20% ─────────────────────────────────────────
  console.log("\n════════════════════════════════════════");
  console.log("  Step 4 — Portfolio gains +20%");
  console.log("════════════════════════════════════════");

  const newPrices: AssetPrices = {
    aaplx: 180_000_000n,  // $150 → $180
    tslax: 240_000_000n,  // $200 → $240
    nvdax: 960_000_000n,  // $800 → $960
  };
  await coordinator.simulatePriceChange(newPrices);

  await printStatus(userVault, userAddr, "After +20% Price Gain");

  // ── Step 5: Second deposit 500 USDC ─────────────────────────────────────────
  console.log("\n════════════════════════════════════════");
  console.log("  Step 5 — Second deposit 500 USDC (at higher NAV)");
  console.log("════════════════════════════════════════");

  await (await userUsdc.approve(await vault.getAddress(), ethers.parseUnits("500", 6))).wait();
  const deposit2Tx = await userVault.deposit(ethers.parseUnits("500", 6), userAddr);
  await deposit2Tx.wait();

  const totalShares2 = await vault.totalSupply();
  const newSharesMinted = BigInt(totalShares2) - BigInt(shares1);
  await coordinator.processDeposit(ethers.parseUnits("500", 6), 2n, newSharesMinted);

  await printStatus(userVault, userAddr, "After Second Deposit");

  // ── Step 6: Redeem 50% of shares ────────────────────────────────────────────
  console.log("\n════════════════════════════════════════");
  console.log("  Step 6 — User redeems 50% of shares");
  console.log("════════════════════════════════════════");

  const sharesHeld = BigInt(await vault.balanceOf(userAddr));
  const redeemShares = sharesHeld / 2n;
  const usdcBefore = BigInt(await usdc.balanceOf(userAddr));

  const redeemTx = await userVault.redeem(redeemShares, userAddr, userAddr);
  const redeemReceipt = await redeemTx.wait();
  const redeemId = parseRedeemId(redeemReceipt!);

  // Coordinator: sell on Solana, bridge USDC back
  await coordinator.processRedeem(redeemShares, redeemId, userAddr);

  const usdcAfter = BigInt(await usdc.balanceOf(userAddr));
  const usdcReceived = usdcAfter - usdcBefore;

  console.log(`\n  Shares redeemed : ${fmt(redeemShares)}`);
  console.log(`  USDC received   : ${fmt(usdcReceived)} USDC`);

  await printStatus(userVault, userAddr, "After Redeem");

  // ── Summary ──────────────────────────────────────────────────────────────────
  const sharesRemaining = BigInt(await vault.balanceOf(userAddr));
  const finalNAV = BigInt(await vault.reportedNAV());

  console.log(`
╔══════════════════════════════════════════════╗
║       MULTI-CHAIN ETF DEMO — SUMMARY         ║
╠══════════════════════════════════════════════╣
║  Deposit 1  : 1000.00 USDC → 1000.00 mETF   ║
║  Deposit 2  :  500.00 USDC → fewer shares    ║`);
  console.log(`║  USDC from redeem : ${fmt(usdcReceived).padStart(9)} USDC              ║`);
  console.log(`║  Remaining shares : ${fmt(sharesRemaining).padStart(9)} mETF              ║`);
  console.log(`║  Remaining NAV    : ${fmt(finalNAV).padStart(9)} USDC              ║`);
  console.log(`╚══════════════════════════════════════════════╝`);

  await coordinator.stop();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
