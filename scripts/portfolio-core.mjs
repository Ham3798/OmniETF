export const USDC_DECIMALS = 6;
export const USDC_UNIT = 1_000_000n;

export const DEFAULT_ASSETS = [
  { symbol: "AAPLx", weightBps: 4_000, priceUsd: "200" },
  { symbol: "TSLAx", weightBps: 3_000, priceUsd: "350" },
  { symbol: "NVDAx", weightBps: 3_000, priceUsd: "1000" },
];

export function createLedger({
  usdcBaseUnits,
  tokenAccount,
  sourceTx,
  receiveTx,
  assets = DEFAULT_ASSETS,
  generatedAt = new Date().toISOString(),
}) {
  const totalUsdcBaseUnits = BigInt(usdcBaseUnits);
  if (totalUsdcBaseUnits <= 0n) throw new Error("USDC balance must be positive");

  const totalWeight = assets.reduce((sum, asset) => sum + asset.weightBps, 0);
  if (totalWeight !== 10_000) throw new Error(`Asset weights must sum to 10000 bps, got ${totalWeight}`);

  const allocations = assets.map((asset) => {
    const allocatedBaseUnits = (totalUsdcBaseUnits * BigInt(asset.weightBps)) / 10_000n;
    const priceBaseUnits = parseUsdToBaseUnits(asset.priceUsd);
    return {
      symbol: asset.symbol,
      targetWeightBps: asset.weightBps,
      priceUsd: formatBaseUnits(priceBaseUnits),
      allocatedUsd: formatBaseUnits(allocatedBaseUnits),
      allocatedBaseUnits: allocatedBaseUnits.toString(),
      mockQuantity: formatQuantity(allocatedBaseUnits, priceBaseUnits),
    };
  });

  return {
    version: 1,
    generatedAt,
    mode: "mock-xstock-ledger",
    source: {
      chain: "solana-devnet",
      usdcTokenAccount: tokenAccount ?? null,
      cctpSourceTx: sourceTx ?? null,
      cctpReceiveTx: receiveTx ?? null,
    },
    shareAccounting: {
      rule: "1 received USDC = 1 OmniETF share",
      totalShareUnits: totalUsdcBaseUnits.toString(),
      totalShares: formatBaseUnits(totalUsdcBaseUnits),
      decimals: USDC_DECIMALS,
    },
    portfolio: {
      totalValueBaseUnits: totalUsdcBaseUnits.toString(),
      totalValueUsd: formatBaseUnits(totalUsdcBaseUnits),
      navBaseUnits: USDC_UNIT.toString(),
      navUsd: "1",
      assets: allocations,
    },
  };
}

export function summarizeNav(ledger) {
  const totalValue = BigInt(ledger.portfolio.totalValueBaseUnits);
  const totalShares = BigInt(ledger.shareAccounting.totalShareUnits);
  if (totalShares <= 0n) throw new Error("Ledger has no shares");

  const navBaseUnits = (totalValue * USDC_UNIT) / totalShares;
  const assets = ledger.portfolio.assets.map((asset) => {
    const allocated = BigInt(asset.allocatedBaseUnits);
    const currentWeightBps = Number((allocated * 10_000n) / totalValue);
    return { ...asset, currentWeightBps };
  });

  return {
    totalPortfolioUsd: formatBaseUnits(totalValue),
    totalShares: formatBaseUnits(totalShares),
    navUsd: formatBaseUnits(navBaseUnits),
    redeemableUsdcEstimate: formatBaseUnits(totalValue),
    assets,
  };
}

export function quoteRedeem(ledger, shares) {
  const shareUnits = parseUsdToBaseUnits(shares);
  const totalShares = BigInt(ledger.shareAccounting.totalShareUnits);
  const totalValue = BigInt(ledger.portfolio.totalValueBaseUnits);

  if (shareUnits <= 0n) throw new Error("Redeem shares must be positive");
  if (shareUnits > totalShares) throw new Error("Redeem shares exceed total shares");

  const redeemBaseUnits = (totalValue * shareUnits) / totalShares;
  const assetSales = ledger.portfolio.assets.map((asset) => {
    const allocated = BigInt(asset.allocatedBaseUnits);
    const saleBaseUnits = (allocated * shareUnits) / totalShares;
    const priceBaseUnits = parseUsdToBaseUnits(asset.priceUsd);
    return {
      symbol: asset.symbol,
      sellUsd: formatBaseUnits(saleBaseUnits),
      sellBaseUnits: saleBaseUnits.toString(),
      mockQuantitySold: formatQuantity(saleBaseUnits, priceBaseUnits),
    };
  });

  return {
    shares,
    shareUnits: shareUnits.toString(),
    redeemableUsdc: formatBaseUnits(redeemBaseUnits),
    redeemableBaseUnits: redeemBaseUnits.toString(),
    assetSales,
    note: "Mock quote only. Real redeem requires selling Solana assets to USDC and sending USDC back with CCTP Solana -> Base.",
  };
}

export function executeRedeemSettlement(
  ledger,
  shares,
  {
    redeemId = null,
    reverseDestinationDomain = null,
    reverseMintRecipient = null,
    reverseDestinationCaller = null,
    solanaUsdcMint = null,
    generatedAt = new Date().toISOString(),
  } = {},
) {
  const quote = quoteRedeem(ledger, shares);
  const shareUnits = BigInt(quote.shareUnits);
  const redeemBaseUnits = BigInt(quote.redeemableBaseUnits);
  const totalShares = BigInt(ledger.shareAccounting.totalShareUnits);
  const totalValue = BigInt(ledger.portfolio.totalValueBaseUnits);

  const saleBySymbol = new Map(quote.assetSales.map((sale) => [sale.symbol, sale]));
  const nextAssets = ledger.portfolio.assets.map((asset) => {
    const sale = saleBySymbol.get(asset.symbol);
    if (!sale) throw new Error(`Missing redeem sale for ${asset.symbol}`);
    const nextAllocated = BigInt(asset.allocatedBaseUnits) - BigInt(sale.sellBaseUnits);
    const priceBaseUnits = parseUsdToBaseUnits(asset.priceUsd);
    return {
      ...asset,
      allocatedUsd: formatBaseUnits(nextAllocated),
      allocatedBaseUnits: nextAllocated.toString(),
      mockQuantity: formatQuantity(nextAllocated, priceBaseUnits),
    };
  });

  const nextTotalShares = totalShares - shareUnits;
  const nextTotalValue = totalValue - redeemBaseUnits;
  const nextLedger = {
    ...ledger,
    generatedAt,
    shareAccounting: {
      ...ledger.shareAccounting,
      totalShareUnits: nextTotalShares.toString(),
      totalShares: formatBaseUnits(nextTotalShares),
    },
    portfolio: {
      ...ledger.portfolio,
      totalValueBaseUnits: nextTotalValue.toString(),
      totalValueUsd: formatBaseUnits(nextTotalValue),
      navBaseUnits:
        nextTotalShares === 0n
          ? USDC_UNIT.toString()
          : ((nextTotalValue * USDC_UNIT) / nextTotalShares).toString(),
      navUsd: nextTotalShares === 0n ? "1" : formatBaseUnits((nextTotalValue * USDC_UNIT) / nextTotalShares),
      assets: nextAssets,
    },
    lastRedeemSettlement: {
      generatedAt,
      redeemId,
      shares,
      shareUnits: quote.shareUnits,
      assetsClaimable: quote.redeemableBaseUnits,
      redeemableUsdc: quote.redeemableUsdc,
      assetSales: quote.assetSales,
    },
  };

  return {
    quote,
    nextLedger,
    settlement: {
      version: 1,
      generatedAt,
      mode: "mock-redeem-settlement-executed",
      redeemId,
      shares,
      shareUnits: quote.shareUnits,
      assetsClaimable: quote.redeemableBaseUnits,
      redeemableUsdc: quote.redeemableUsdc,
      assetSales: quote.assetSales,
      remainingPortfolio: summarizeNav(nextLedger),
      reverseCctpBurnIntent: {
        sourceChain: "solana-devnet",
        sourceUsdcTokenAccount: ledger.source.usdcTokenAccount ?? null,
        burnToken: solanaUsdcMint,
        destinationChain: "base-sepolia",
        destinationDomain: reverseDestinationDomain,
        mintRecipient: reverseMintRecipient,
        destinationCaller: reverseDestinationCaller,
        amount: quote.redeemableBaseUnits,
        note: "After this Solana -> Base CCTP transfer mints USDC into the vault, call MarkOmniETFRedeemClaimable.",
      },
      nextEnv: {
        OMNIETF_REDEEM_ID: redeemId ?? "0x...",
        REDEEM_ASSETS_CLAIMABLE: quote.redeemableBaseUnits,
      },
      nextCommand:
        "npm run cctp:burn-solana && npm run cctp:receive-evm && forge script script/MarkOmniETFRedeemClaimable.s.sol:MarkOmniETFRedeemClaimable --rpc-url \"$BASE_SEPOLIA_RPC_URL\" --broadcast",
    },
  };
}

export function parseUsdToBaseUnits(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, fraction = ""] = text.split(".");
  const padded = `${fraction}000000`.slice(0, USDC_DECIMALS);
  return BigInt(`${whole}${padded}`);
}

export function formatBaseUnits(value) {
  const amount = BigInt(value);
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / USDC_UNIT;
  const fraction = String(absolute % USDC_UNIT).padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function formatQuantity(allocatedBaseUnits, priceBaseUnits) {
  const quantityScale = 1_000_000_000n;
  const quantityUnits = (allocatedBaseUnits * quantityScale) / priceBaseUnits;
  const whole = quantityUnits / quantityScale;
  const fraction = String(quantityUnits % quantityScale).padStart(9, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
