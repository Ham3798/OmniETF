import assert from "node:assert/strict";
import { createLedger, quoteRedeem, summarizeNav } from "./portfolio-core.mjs";

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

console.log("portfolio self-test passed");
