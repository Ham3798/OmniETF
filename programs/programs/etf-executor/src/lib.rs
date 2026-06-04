use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("ETFExec11111111111111111111111111111111111");

#[program]
pub mod etf_executor {
    use super::*;

    /// Initialize the treasury and portfolio configuration PDAs.
    /// Must be called once before any deposits or redeems.
    pub fn initialize(
        ctx: Context<Initialize>,
        base_vault_address: [u8; 20],
        aaplx_weight_bps: u16,
        tslax_weight_bps: u16,
        nvdax_weight_bps: u16,
        aaplx_price: u64,
        tslax_price: u64,
        nvdax_price: u64,
    ) -> Result<()> {
        initialize::handler(
            ctx,
            base_vault_address,
            aaplx_weight_bps,
            tslax_weight_bps,
            nvdax_weight_bps,
            aaplx_price,
            tslax_price,
            nvdax_price,
        )
    }

    /// Called by the off-chain coordinator when a BridgeRequested event is
    /// detected on Base. Simulates swapping USDC into the portfolio.
    /// shares_minted mirrors the share count issued on Base chain.
    pub fn execute_deposit(
        ctx: Context<ExecuteDeposit>,
        usdc_amount: u64,
        deposit_id: u64,
        shares_minted: u64,
    ) -> Result<()> {
        execute_deposit::handler(ctx, usdc_amount, deposit_id, shares_minted)
    }

    /// Called by the coordinator when a RedeemRequested event fires on Base.
    /// Proportionally sells assets and returns the USDC amount to bridge back.
    pub fn execute_redeem(
        ctx: Context<ExecuteRedeem>,
        shares_to_redeem: u64,
        redeem_id: u64,
    ) -> Result<u64> {
        execute_redeem::handler(ctx, shares_to_redeem, redeem_id)
    }

    /// Rebalance portfolio to (optionally new) target weights.
    /// Pass 0 for prices/weights to keep existing values.
    pub fn rebalance(
        ctx: Context<Rebalance>,
        new_aaplx_weight: u16,
        new_tslax_weight: u16,
        new_nvdax_weight: u16,
        new_aaplx_price: u64,
        new_tslax_price: u64,
        new_nvdax_price: u64,
    ) -> Result<()> {
        rebalance::handler(
            ctx,
            new_aaplx_weight,
            new_tslax_weight,
            new_nvdax_weight,
            new_aaplx_price,
            new_tslax_price,
            new_nvdax_price,
        )
    }

    /// Update mock asset prices and recompute NAV.
    /// In production, replace with a Pyth / Switchboard oracle crank.
    pub fn update_prices(
        ctx: Context<UpdatePrices>,
        aaplx_price: u64,
        tslax_price: u64,
        nvdax_price: u64,
    ) -> Result<()> {
        update_prices::handler(ctx, aaplx_price, tslax_price, nvdax_price)
    }
}
