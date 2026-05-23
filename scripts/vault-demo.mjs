import { existsSync, readFileSync } from "node:fs";

await loadEnv();

const ledgerPath = process.env.PORTFOLIO_LEDGER_PATH ?? ".omnietf/portfolio-ledger.json";
if (!existsSync(ledgerPath)) {
  throw new Error(`Ledger not found: ${ledgerPath}. Run npm run portfolio:allocate first.`);
}

const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const executedValue = ledger.portfolio.totalValueBaseUnits;

console.log(JSON.stringify({
  standardModel: "ERC-7540-style async deposit + ERC-4626 share math",
  shareToken: "mETF ERC-20 on Base",
  lifecycle: "Requested -> Settled -> Executed -> Finalized",
  depositTiming: "requestDeposit starts CCTP; finalizeDeposit mints shares after Solana execution value is known",
  executedValueUsdc: ledger.portfolio.totalValueUsd,
  executedValueBaseUnits: executedValue,
  firstDepositExpectedShares: ledger.shareAccounting.totalShares,
  command: [
    "forge script script/FinalizeOmniETFDeposit.s.sol:FinalizeOmniETFDeposit",
    "--rpc-url \"$BASE_SEPOLIA_RPC_URL\"",
    "--broadcast",
  ].join(" "),
}, null, 2));

async function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...parts] = trimmed.split("=");
    process.env[key] ??= parts.join("=");
  }
}
