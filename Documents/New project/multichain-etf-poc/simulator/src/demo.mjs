import { createDefaultSystem, formatUsd } from "../../shared/js/poc-core.mjs";
import { portfolioConfig } from "../../shared/js/portfolio-config.mjs";

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

const { relayer, vault, executor } = createDefaultSystem();

printSection("1. Deposit On Base");
const userDeposit = 1000;
const minted = relayer.queueDeposit(userDeposit);
console.log(`User deposits ${formatUsd(userDeposit)}`);
console.log(`Vault mints ${minted.shares.toFixed(2)} ${portfolioConfig.symbol}`);
console.log(`Active NAV on Base: ${formatUsd(vault.activeAssets)}`);

printSection("2. Bridge To Solana");
relayer.processNext();
console.log(`Vault bridges ${formatUsd(userDeposit)} to Solana`);
console.log(`Base idle assets: ${formatUsd(vault.baseIdleAssets)}`);
console.log(`Solana managed assets: ${formatUsd(vault.solanaManagedAssets)}`);

printSection("3. Allocate Portfolio");
const buySwaps = executor.snapshot().positions.map((position) => ({
  from: "USDC",
  to: position.symbol,
  amount: position.value
}));
for (const swap of buySwaps) {
  console.log(`Swap ${formatUsd(swap.amount)} from ${swap.from} to ${swap.to}`);
}
console.log(`Executor NAV after allocation: ${formatUsd(executor.nav)}`);

printSection("4. Mark To Market");
relayer.queuePriceScenario(portfolioConfig.marketScenarios.bull, "bull");
relayer.processNext();
console.log(`Marked Solana NAV: ${formatUsd(executor.nav)}`);
console.log(`Base active NAV after sync: ${formatUsd(vault.activeAssets)}`);
console.log(`Implied share price: ${(vault.activeAssets / vault.totalShares).toFixed(4)} USDC`);

printSection("5. Redeem Request");
const redeemShares = 300;
console.log(`User requests redeem for ${redeemShares.toFixed(2)} ${portfolioConfig.symbol}`);
relayer.queueRedeem(redeemShares);
console.log(`Redeem request queued to relayer`);

printSection("6. Solana Liquidation And Bridge Return");
const redeemResult = relayer.processNext();
console.log(`Redeem claim reserved and settled: ${formatUsd(redeemResult.redemption.assets)}`);
for (const swap of redeemResult.swaps) {
  console.log(`Swap ${formatUsd(swap.amount)} from ${swap.from} to ${swap.to}`);
}
console.log(`Executor cash after bridge return: ${formatUsd(executor.cash)}`);
console.log(`Executor NAV after liquidation: ${formatUsd(executor.nav)}`);

printSection("7. Bridge Back And Settle");
console.log(`Bridge returns ${formatUsd(redeemResult.redemption.assets)} to Base`);
console.log(`Redeem settled to user`);
console.log(`Vault total shares outstanding: ${vault.totalShares.toFixed(2)} ${portfolioConfig.symbol}`);
console.log(`Vault active NAV after settlement: ${formatUsd(vault.activeAssets)}`);
console.log(`Post-redeem share price: ${(vault.activeAssets / vault.totalShares).toFixed(4)} USDC`);
