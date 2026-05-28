import { portfolioConfig } from "./portfolio-config.mjs";

function round(amount) {
  return Number(amount.toFixed(6));
}

function assertPositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}

export function formatUsd(amount) {
  return `${round(amount).toFixed(2)} USDC`;
}

export class Vault {
  constructor(symbol = portfolioConfig.symbol) {
    this.symbol = symbol;
    this.totalShares = 0;
    this.baseIdleAssets = 0;
    this.solanaManagedAssets = 0;
    this.reservedRedemptionAssets = 0;
    this.nextRedemptionId = 1;
    this.redemptions = [];
  }

  get activeAssets() {
    return round(this.baseIdleAssets + this.solanaManagedAssets - this.reservedRedemptionAssets);
  }

  get sharePrice() {
    if (this.totalShares === 0) {
      return 1;
    }

    return round(this.activeAssets / this.totalShares);
  }

  deposit(assets, receiver = "user") {
    assertPositive(assets, "deposit assets");

    const shares = this.totalShares === 0 || this.activeAssets === 0
      ? assets
      : assets * (this.totalShares / this.activeAssets);

    this.baseIdleAssets = round(this.baseIdleAssets + assets);
    this.totalShares = round(this.totalShares + shares);

    return {
      type: "deposit",
      receiver,
      assets: round(assets),
      shares: round(shares)
    };
  }

  bridgeToSolana(assets, actionId) {
    assertPositive(assets, "bridge assets");
    if (assets > this.baseIdleAssets) {
      throw new Error("bridge exceeds Base idle assets");
    }

    this.baseIdleAssets = round(this.baseIdleAssets - assets);
    this.solanaManagedAssets = round(this.solanaManagedAssets + assets);

    return {
      type: "bridge_out",
      assets: round(assets),
      actionId
    };
  }

  syncSolanaNav(nav) {
    this.solanaManagedAssets = round(nav);
    return {
      type: "nav_sync",
      nav: round(nav)
    };
  }

  requestRedeem(shares, receiver = "user") {
    assertPositive(shares, "redeem shares");
    if (shares > this.totalShares) {
      throw new Error("redeem exceeds outstanding shares");
    }

    const assets = round(shares * this.sharePrice);
    const redemption = {
      redemptionId: this.nextRedemptionId++,
      receiver,
      shares: round(shares),
      assets,
      settled: false
    };

    this.totalShares = round(this.totalShares - shares);
    this.reservedRedemptionAssets = round(this.reservedRedemptionAssets + assets);
    this.redemptions.push(redemption);

    return {
      type: "redeem_requested",
      ...redemption
    };
  }

  prepareRedemption(assets) {
    assertPositive(assets, "redemption assets");
    if (assets > this.solanaManagedAssets) {
      throw new Error("redemption exceeds Solana managed assets");
    }

    this.solanaManagedAssets = round(this.solanaManagedAssets - assets);
    return {
      type: "prepare_redemption",
      assets: round(assets)
    };
  }

  receiveBridgeReturn(assets) {
    assertPositive(assets, "bridge return assets");
    this.baseIdleAssets = round(this.baseIdleAssets + assets);
    return {
      type: "bridge_return",
      assets: round(assets)
    };
  }

  settleRedeem(redemptionId) {
    const redemption = this.redemptions.find((item) => item.redemptionId === redemptionId);

    if (!redemption || redemption.settled) {
      throw new Error(`Invalid redemption ${redemptionId}`);
    }

    this.baseIdleAssets = round(this.baseIdleAssets - redemption.assets);
    this.reservedRedemptionAssets = round(this.reservedRedemptionAssets - redemption.assets);
    redemption.settled = true;

    return {
      type: "redeem_settled",
      redemptionId,
      receiver: redemption.receiver,
      assets: round(redemption.assets)
    };
  }

  snapshot() {
    return {
      symbol: this.symbol,
      totalShares: round(this.totalShares),
      baseIdleAssets: round(this.baseIdleAssets),
      solanaManagedAssets: round(this.solanaManagedAssets),
      reservedRedemptionAssets: round(this.reservedRedemptionAssets),
      activeAssets: round(this.activeAssets),
      sharePrice: round(this.sharePrice)
    };
  }
}

export class SolanaExecutor {
  constructor(weights = portfolioConfig.weights, initialPrices = portfolioConfig.initialPrices) {
    this.weights = weights.map((item) => ({ ...item }));
    this.positions = weights.map(({ symbol }) => ({
      symbol,
      units: 0,
      price: initialPrices[symbol]
    }));
    this.cash = 0;
  }

  get nav() {
    const positionsValue = this.positions.reduce(
      (sum, position) => sum + (position.units * position.price),
      0
    );

    return round(this.cash + positionsValue);
  }

  receiveBridgedUsdc(amount) {
    assertPositive(amount, "bridged usdc");
    this.cash = round(this.cash + amount);
    return {
      type: "solana_cash_in",
      assets: round(amount)
    };
  }

  allocateByTarget() {
    const startingCash = this.cash;
    let spent = 0;
    const swaps = [];

    this.weights.forEach((weight, index) => {
      const allocation = index === this.weights.length - 1
        ? round(startingCash - spent)
        : round(startingCash * (weight.weightBps / 10_000));

      const position = this.positions.find((item) => item.symbol === weight.symbol);
      position.units = round(position.units + (allocation / position.price));
      this.cash = round(this.cash - allocation);
      spent = round(spent + allocation);

      swaps.push({
        from: "USDC",
        to: weight.symbol,
        amount: allocation
      });
    });

    return swaps;
  }

  markPrices(nextPrices) {
    this.positions.forEach((position) => {
      if (nextPrices[position.symbol] !== undefined) {
        position.price = round(nextPrices[position.symbol]);
      }
    });

    return {
      type: "mark_prices",
      prices: this.positions.reduce((acc, position) => {
        acc[position.symbol] = position.price;
        return acc;
      }, {})
    };
  }

  liquidateProRata(amount) {
    assertPositive(amount, "liquidation amount");

    const portfolioValue = this.positions.reduce(
      (sum, position) => sum + (position.units * position.price),
      0
    );
    if (amount > this.nav) {
      throw new Error("liquidation exceeds executor NAV");
    }
    if (portfolioValue === 0) {
      throw new Error("cannot liquidate an empty portfolio");
    }

    let sold = 0;
    const swaps = [];

    this.positions.forEach((position, index) => {
      const notional = position.units * position.price;
      const sellValue = index === this.positions.length - 1
        ? round(amount - sold)
        : round(amount * (notional / portfolioValue));

      const unitsToSell = round(sellValue / position.price);
      position.units = round(position.units - unitsToSell);
      this.cash = round(this.cash + sellValue);
      sold = round(sold + sellValue);

      swaps.push({
        from: position.symbol,
        to: "USDC",
        amount: sellValue
      });
    });

    return swaps;
  }

  withdrawCash(amount) {
    assertPositive(amount, "withdraw amount");
    if (amount > this.cash) {
      throw new Error("withdraw exceeds executor cash");
    }

    this.cash = round(this.cash - amount);
    return {
      type: "solana_cash_out",
      assets: round(amount)
    };
  }

  snapshot() {
    return {
      cash: round(this.cash),
      nav: round(this.nav),
      positions: this.positions.map((position) => ({
        symbol: position.symbol,
        units: round(position.units),
        price: round(position.price),
        value: round(position.units * position.price)
      }))
    };
  }
}

export class MockRelayer {
  constructor({ vault, executor }) {
    this.vault = vault;
    this.executor = executor;
    this.queue = [];
    this.timeline = [];
    this.nextActionId = 1;
  }

  queueDeposit(assets) {
    const deposit = this.vault.deposit(assets);
    this.queue.push({
      kind: "deposit",
      assets: deposit.assets,
      actionId: `deposit-${this.nextActionId++}`
    });
    this.pushLog(`Base deposit accepted: ${formatUsd(deposit.assets)} -> ${deposit.shares.toFixed(2)} ${this.vault.symbol}`);
    return deposit;
  }

  queuePriceScenario(prices, label = "custom") {
    this.queue.push({
      kind: "price_sync",
      prices,
      actionId: `price-${this.nextActionId++}`,
      label
    });
    this.pushLog(`Relayer queued NAV sync for scenario "${label}"`);
  }

  queueRedeem(shares) {
    this.queue.push({
      kind: "redeem",
      shares: round(shares),
      actionId: `redeem-${this.nextActionId++}`
    });
    this.pushLog(`User queued redeem for ${round(shares).toFixed(2)} ${this.vault.symbol}`);
  }

  processNext() {
    const next = this.queue.shift();

    if (!next) {
      this.pushLog("Relayer idle: no queued actions");
      return null;
    }

    if (next.kind === "deposit") {
      this.vault.bridgeToSolana(next.assets, next.actionId);
      this.executor.receiveBridgedUsdc(next.assets);
      const swaps = this.executor.allocateByTarget();
      this.vault.syncSolanaNav(this.executor.nav);
      this.pushLog(`Bridged ${formatUsd(next.assets)} to Solana and allocated ${swaps.length} target positions`);
      return {
        kind: next.kind,
        swaps
      };
    }

    if (next.kind === "price_sync") {
      this.executor.markPrices(next.prices);
      this.vault.syncSolanaNav(this.executor.nav);
      this.pushLog(`Synced Solana NAV after "${next.label}" market move: ${formatUsd(this.executor.nav)}`);
      return {
        kind: next.kind,
        nav: this.executor.nav
      };
    }

    if (next.kind === "redeem") {
      const redemption = this.vault.requestRedeem(next.shares);
      this.vault.prepareRedemption(redemption.assets);
      const swaps = this.executor.liquidateProRata(redemption.assets);
      this.executor.withdrawCash(redemption.assets);
      this.vault.receiveBridgeReturn(redemption.assets);
      this.vault.settleRedeem(redemption.redemptionId);
      this.vault.syncSolanaNav(this.executor.nav);
      this.pushLog(`Redeem settled: ${formatUsd(redemption.assets)} returned to user after ${swaps.length} Solana sells`);
      return {
        kind: next.kind,
        redemption,
        swaps
      };
    }

    throw new Error(`Unsupported queue item: ${next.kind}`);
  }

  processAll() {
    const results = [];

    while (this.queue.length > 0) {
      results.push(this.processNext());
    }

    return results;
  }

  pushLog(message) {
    this.timeline.unshift({
      at: new Date().toISOString(),
      message
    });
  }

  snapshot() {
    return {
      queue: this.queue.map((item) => ({ ...item })),
      timeline: [...this.timeline],
      vault: this.vault.snapshot(),
      executor: this.executor.snapshot()
    };
  }
}

export function createDefaultSystem() {
  const vault = new Vault(portfolioConfig.symbol);
  const executor = new SolanaExecutor(portfolioConfig.weights, portfolioConfig.initialPrices);
  const relayer = new MockRelayer({ vault, executor });

  return {
    config: portfolioConfig,
    vault,
    executor,
    relayer
  };
}
