import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createLedger, executeRedeemSettlement, quoteRedeem, summarizeNav } from "./portfolio-core.mjs";

const ledger = createLedger({
  usdcBaseUnits: "999870",
  tokenAccount: "MockTokenAccount",
  sourceTx: "0xsource",
  receiveTx: "solanaReceive",
  generatedAt: "2026-05-24T00:00:00.000Z",
});

assert.equal(ledger.shareAccounting.totalShares, "0.99987");
assert.equal(ledger.portfolio.assets[0].symbol, "AAPLx");
assert.equal(ledger.portfolio.assets[0].allocatedBaseUnits, "399948");
assert.equal(ledger.portfolio.assets[1].allocatedBaseUnits, "299961");
assert.equal(ledger.portfolio.assets[2].allocatedBaseUnits, "299961");

const nav = summarizeNav(ledger);
assert.equal(nav.totalPortfolioUsd, "0.99987");
assert.equal(nav.totalShares, "0.99987");
assert.equal(nav.navUsd, "1");
assert.equal(nav.assets.map((asset) => asset.currentWeightBps).join(","), "4000,3000,3000");

const redeem = quoteRedeem(ledger, "0.5");
assert.equal(redeem.redeemableUsdc, "0.5");
assert.equal(redeem.assetSales[0].sellUsd, "0.2");
assert.equal(redeem.assetSales[1].sellUsd, "0.15");
assert.equal(redeem.assetSales[2].sellUsd, "0.15");

const settlementPath = ".omnietf/test-redeem-settlement.json";
const ledgerPath = ".omnietf/test-portfolio-ledger.json";
if (existsSync(settlementPath)) rmSync(settlementPath);
mkdirSync(".omnietf", { recursive: true });
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
const settlement = spawnSync(
  "node",
  [
    "scripts/redeem-settlement.mjs",
    "--ledger",
    ledgerPath,
    "--out",
    settlementPath,
    "--shares",
    "0.5",
  ],
  { encoding: "utf8" },
);
assert.equal(settlement.status, 0, settlement.stderr);
const settlementJson = JSON.parse(readFileSync(settlementPath, "utf8"));
assert.equal(settlementJson.assetsClaimable, "500000");
assert.equal(settlementJson.nextEnv.REDEEM_ASSETS_CLAIMABLE, "500000");

const executed = executeRedeemSettlement(ledger, "0.5", {
  redeemId: "0xredeem",
  reverseDestinationDomain: "6",
  reverseMintRecipient: "0x00000000000000000000000017fa3a0584fa5fe9ec535905b12929fda5db927f",
  reverseDestinationCaller: "0x0000000000000000000000000000000000000000000000000000000000000000",
  solanaUsdcMint: "MockDevnetUsdcMint",
  generatedAt: "2026-05-24T00:00:01.000Z",
});
assert.equal(executed.settlement.mode, "mock-redeem-settlement-executed");
assert.equal(executed.settlement.assetsClaimable, "500000");
assert.equal(executed.settlement.reverseCctpBurnIntent.amount, "500000");
assert.equal(executed.nextLedger.shareAccounting.totalShareUnits, "499870");
assert.equal(executed.nextLedger.portfolio.totalValueBaseUnits, "499870");
assert.equal(executed.nextLedger.portfolio.assets[0].allocatedBaseUnits, "199948");

const executedSettlementPath = ".omnietf/test-redeem-settlement-executed.json";
const executedLedgerPath = ".omnietf/test-portfolio-ledger-executed.json";
if (existsSync(executedSettlementPath)) rmSync(executedSettlementPath);
writeFileSync(executedLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
const executedSettlement = spawnSync(
  "node",
  [
    "scripts/redeem-settlement.mjs",
    "--ledger",
    executedLedgerPath,
    "--out",
    executedSettlementPath,
    "--shares",
    "0.5",
    "--redeem-id",
    "0xredeem",
    "--execute",
    "--reverse-destination-domain",
    "6",
    "--reverse-mint-recipient",
    "0x00000000000000000000000017fa3a0584fa5fe9ec535905b12929fda5db927f",
  ],
  { encoding: "utf8" },
);
assert.equal(executedSettlement.status, 0, executedSettlement.stderr);
const executedSettlementJson = JSON.parse(readFileSync(executedSettlementPath, "utf8"));
const executedLedgerJson = JSON.parse(readFileSync(executedLedgerPath, "utf8"));
assert.equal(executedSettlementJson.mode, "mock-redeem-settlement-executed");
assert.equal(executedSettlementJson.nextCommand.includes("cctp:burn-solana"), true);
assert.equal(executedSettlementJson.nextCommand.includes("cctp:receive-evm"), true);
assert.equal(executedSettlementJson.nextCommand.includes("MarkOmniETFRedeemClaimable"), true);
assert.equal(executedLedgerJson.lastRedeemSettlement.assetsClaimable, "500000");
assert.equal(executedLedgerJson.shareAccounting.totalShareUnits, "499870");

const burnDryRun = spawnSync(
  "node",
  [
    "scripts/burn-cctp-solana.mjs",
    "--dry-run",
    "--amount",
    "500000",
    "--destination-domain",
    "6",
    "--mint-recipient",
    "0x00000000000000000000000017fa3a0584fa5fe9ec535905b12929fda5db927f",
    "--source-token-account",
    "11111111111111111111111111111111",
  ],
  { encoding: "utf8" },
);
assert.equal(burnDryRun.status, 0, burnDryRun.stderr);
const burnDryRunJson = JSON.parse(burnDryRun.stdout);
assert.equal(burnDryRunJson.mode, "solana-cctp-v2-deposit-for-burn");
assert.equal(burnDryRunJson.dryRun, true);
assert.equal(burnDryRunJson.amount, "500000");
assert.equal(burnDryRunJson.instructionDataBytes, 96);
assert.equal(burnDryRunJson.accountCount, 20);

const receiveDryRun = spawnSync(
  "node",
  [
    "scripts/receive-cctp-evm.mjs",
    "--dry-run",
    "--source-domain",
    "5",
    "--tx",
    "MockSolanaBurnSignature",
    "--message-transmitter",
    "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    "--rpc-url",
    "http://127.0.0.1:8545",
    "--private-key",
    "0x1111111111111111111111111111111111111111111111111111111111111111",
    "--message",
    "0x1234",
    "--attestation",
    "0xabcd",
  ],
  { encoding: "utf8" },
);
assert.equal(receiveDryRun.status, 0, receiveDryRun.stderr);
const receiveDryRunJson = JSON.parse(receiveDryRun.stdout);
assert.equal(receiveDryRunJson.mode, "evm-cctp-v2-receive-message");
assert.equal(receiveDryRunJson.dryRun, true);
assert.equal(receiveDryRunJson.messageBytes, 2);
assert.equal(receiveDryRunJson.attestationBytes, 2);
assert.equal(receiveDryRunJson.command.includes("receiveMessage(bytes,bytes)"), true);
assert.equal(receiveDryRunJson.command.includes("<redacted>"), true);

console.log("portfolio self-test passed");
