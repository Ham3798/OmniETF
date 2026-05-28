import { createDefaultSystem, formatUsd } from "../../shared/js/poc-core.mjs";
import { portfolioConfig } from "../../shared/js/portfolio-config.mjs";

function print(title) {
  console.log(`\n[${title}]`);
}

const { relayer, vault, executor } = createDefaultSystem();

print("Queue deposit");
relayer.queueDeposit(1000);
console.log(relayer.snapshot().queue);

print("Process deposit");
relayer.processNext();
console.log(`Vault share price: ${vault.sharePrice.toFixed(4)} USDC`);
console.log(`Solana NAV: ${formatUsd(executor.nav)}`);

print("Queue bull repricing");
relayer.queuePriceScenario(portfolioConfig.marketScenarios.bull, "bull");
console.log(relayer.snapshot().queue);

print("Process repricing");
relayer.processNext();
console.log(`Vault share price after NAV sync: ${vault.sharePrice.toFixed(4)} USDC`);

print("Queue redeem");
relayer.queueRedeem(300);
console.log(relayer.snapshot().queue);

print("Process redeem");
relayer.processNext();
console.log(`Outstanding shares: ${vault.totalShares.toFixed(2)} ${vault.symbol}`);
console.log(`Remaining active NAV: ${formatUsd(vault.activeAssets)}`);

print("Timeline");
for (const entry of relayer.snapshot().timeline) {
  console.log(`- ${entry.at} :: ${entry.message}`);
}
