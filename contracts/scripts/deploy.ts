import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. MockUSDC
  const USDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await USDC.deploy();
  await usdc.waitForDeployment();
  console.log("MockUSDC:", await usdc.getAddress());

  // 2. MockBridge
  const Bridge = await ethers.getContractFactory("MockBridge");
  const bridge = await Bridge.deploy(await usdc.getAddress());
  await bridge.waitForDeployment();
  console.log("MockBridge:", await bridge.getAddress());

  // 3. MockNavOracle
  const Oracle = await ethers.getContractFactory("MockNavOracle");
  const oracle = await Oracle.deploy();
  await oracle.waitForDeployment();
  console.log("MockNavOracle:", await oracle.getAddress());

  // 4. ETFVault — Solana treasury placeholder (32 zero bytes for local testing)
  const solanaTreasury = ethers.zeroPadBytes("0x01", 32);
  const Vault = await ethers.getContractFactory("ETFVault");
  const vault = await Vault.deploy(
    await usdc.getAddress(),
    await bridge.getAddress(),
    await oracle.getAddress(),
    solanaTreasury
  );
  await vault.waitForDeployment();
  console.log("ETFVault:", await vault.getAddress());

  // 5. Wire bridge → vault
  await bridge.setVault(await vault.getAddress());
  console.log("Bridge vault set");

  // 6. Fund bridge with USDC to simulate Solana paybacks
  await usdc.mint(await bridge.getAddress(), ethers.parseUnits("1000000", 6));
  console.log("Bridge funded with 1M USDC");

  console.log("\n=== Deployment Complete ===");
  console.log({
    MockUSDC: await usdc.getAddress(),
    MockBridge: await bridge.getAddress(),
    MockNavOracle: await oracle.getAddress(),
    ETFVault: await vault.getAddress(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
