use anchor_lang::prelude::*;

/// Portfolio configuration — target asset weights and mock prices.
/// PDA seeds: ["portfolio-config"]
#[account]
#[derive(Debug)]
pub struct PortfolioConfig {
    /// Target weight for AAPLx in basis points (10000 = 100%)
    pub aaplx_weight_bps: u16,
    /// Target weight for TSLAx in basis points
    pub tslax_weight_bps: u16,
    /// Target weight for NVDAx in basis points
    pub nvdax_weight_bps: u16,
    /// Mock AAPLx price in USDC (6 decimals: 150_000_000 = $150.00)
    pub aaplx_price_usdc: u64,
    /// Mock TSLAx price in USDC (6 decimals: 200_000_000 = $200.00)
    pub tslax_price_usdc: u64,
    /// Mock NVDAx price in USDC (6 decimals: 800_000_000 = $800.00)
    pub nvdax_price_usdc: u64,
    /// Max allowed drift before rebalance is needed (basis points)
    pub rebalance_threshold_bps: u16,
    pub bump: u8,
}

impl PortfolioConfig {
    pub const LEN: usize = 8  // discriminator
        + 2    // aaplx_weight_bps
        + 2    // tslax_weight_bps
        + 2    // nvdax_weight_bps
        + 2    // rebalance_threshold_bps
        + 8    // aaplx_price_usdc
        + 8    // tslax_price_usdc
        + 8    // nvdax_price_usdc
        + 1    // bump
        + 7;   // padding

    /// Total weight must sum to exactly 10000 bps (100%)
    pub fn validate_weights(&self) -> bool {
        let total = self.aaplx_weight_bps as u32
            + self.tslax_weight_bps as u32
            + self.nvdax_weight_bps as u32;
        total == 10_000
    }

    /// Convert USDC amount → token units given token price
    /// usdc_amount: 6 decimals, price_usdc: 6 decimals
    /// returns token units with 6 decimals
    pub fn usdc_to_units(usdc_amount: u64, price_usdc: u64) -> u64 {
        // units = usdc_amount * 1e6 / price_usdc
        (usdc_amount as u128)
            .saturating_mul(1_000_000)
            .checked_div(price_usdc as u128)
            .unwrap_or(0) as u64
    }

    /// Convert token units → USDC given token price
    pub fn units_to_usdc(units: u64, price_usdc: u64) -> u64 {
        // usdc = units * price / 1e6
        (units as u128)
            .saturating_mul(price_usdc as u128)
            .checked_div(1_000_000)
            .unwrap_or(0) as u64
    }
}
