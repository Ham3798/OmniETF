import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { executeRedeemSettlement, quoteRedeem } from "./portfolio-core.mjs";

await loadEnv();

const args = parseArgs(process.argv.slice(2));
const ledgerPath = args.ledger ?? process.env.PORTFOLIO_LEDGER_PATH ?? ".omnietf/portfolio-ledger.json";
const outPath = args.out ?? process.env.REDEEM_SETTLEMENT_PATH ?? ".omnietf/redeem-settlement.json";
const shares = args.shares ?? process.env.REDEEM_SHARES_DECIMAL ?? process.env.REDEEM_SHARES ?? "0.5";
const redeemId = args["redeem-id"] ?? process.env.OMNIETF_REDEEM_ID ?? null;
const execute = Boolean(args.execute);

if (!existsSync(ledgerPath)) {
  throw new Error(`Ledger not found: ${ledgerPath}. Run npm run portfolio:allocate first.`);
}

const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const quote = quoteRedeem(ledger, shares);
const settlement = execute ? executedSettlement(ledger, quote) : quotedSettlement(quote);

if (execute) {
  writeFileSync(ledgerPath, `${JSON.stringify(settlement.nextLedger, null, 2)}\n`);
  delete settlement.nextLedger;
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(settlement, null, 2)}\n`);
console.log(JSON.stringify(settlement, null, 2));

function quotedSettlement(redeemQuote) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: "mock-redeem-settlement",
    ledgerPath,
    redeemId,
    shares,
    shareUnits: redeemQuote.shareUnits,
    assetsClaimable: redeemQuote.redeemableBaseUnits,
    redeemableUsdc: redeemQuote.redeemableUsdc,
    assetSales: redeemQuote.assetSales,
    nextEnv: {
      OMNIETF_REDEEM_ID: redeemId ?? "0x...",
      REDEEM_ASSETS_CLAIMABLE: redeemQuote.redeemableBaseUnits,
    },
    nextCommand:
      "forge script script/FundOmniETFRedeemPayout.s.sol:FundOmniETFRedeemPayout --rpc-url \"$BASE_SEPOLIA_RPC_URL\" --broadcast",
  };
}

function executedSettlement(currentLedger) {
  const reverseMintRecipient =
    args["reverse-mint-recipient"] ??
    process.env.REVERSE_CCTP_MINT_RECIPIENT_BYTES32 ??
    evmAddressToBytes32(process.env.OMNIETF_ASYNC_VAULT);

  const result = executeRedeemSettlement(currentLedger, shares, {
    redeemId,
    reverseDestinationDomain:
      args["reverse-destination-domain"] ?? process.env.REVERSE_CCTP_DESTINATION_DOMAIN ?? null,
    reverseMintRecipient,
    reverseDestinationCaller:
      args["reverse-destination-caller"] ??
      process.env.REVERSE_CCTP_DESTINATION_CALLER_BYTES32 ??
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    solanaUsdcMint: args["solana-usdc-mint"] ?? process.env.SOLANA_USDC_MINT ?? null,
  });

  return {
    ledgerPath,
    nextLedger: result.nextLedger,
    ...result.settlement,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}

function evmAddressToBytes32(address) {
  if (!address) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Invalid EVM address for reverse CCTP mint recipient: ${address}`);
  }
  return `0x${address.slice(2).padStart(64, "0").toLowerCase()}`;
}

async function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...parts] = trimmed.split("=");
    process.env[key] ??= parts.join("=");
  }
}
