use anchor_lang::prelude::*;
use crate::state::{TreasuryState, PortfolioConfig};
use crate::errors::EtfError;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = TreasuryState::LEN,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: Account<'info, TreasuryState>,

    #[account(
        init,
        payer = authority,
        space = PortfolioConfig::LEN,
        seeds = [b"portfolio-config"],
        bump
    )]
    pub portfolio_config: Account<'info, PortfolioConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    base_vault_address: [u8; 20],
    // Initial target weights (bps, must sum to 10000)
    aaplx_weight_bps: u16,
    tslax_weight_bps: u16,
    nvdax_weight_bps: u16,
    // Initial mock prices (USDC, 6 decimals)
    aaplx_price: u64,
    tslax_price: u64,
    nvdax_price: u64,
) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;
    let config = &mut ctx.accounts.portfolio_config;

    require!(
        (aaplx_weight_bps as u32 + tslax_weight_bps as u32 + nvdax_weight_bps as u32) == 10_000,
        EtfError::InvalidWeights
    );
    require!(aaplx_price > 0 && tslax_price > 0 && nvdax_price > 0, EtfError::InvalidPrice);

    treasury.authority = ctx.accounts.authority.key();
    treasury.base_vault_address = base_vault_address;
    treasury.total_usdc_deployed = 0;
    treasury.aaplx_units = 0;
    treasury.tslax_units = 0;
    treasury.nvdax_units = 0;
    treasury.total_shares = 0;
    treasury.nav_per_share = 1_000_000; // 1.00 USDC initial
    treasury.deposit_count = 0;
    treasury.redeem_count = 0;
    treasury.bump = ctx.bumps.treasury;

    config.aaplx_weight_bps = aaplx_weight_bps;
    config.tslax_weight_bps = tslax_weight_bps;
    config.nvdax_weight_bps = nvdax_weight_bps;
    config.aaplx_price_usdc = aaplx_price;
    config.tslax_price_usdc = tslax_price;
    config.nvdax_price_usdc = nvdax_price;
    config.rebalance_threshold_bps = 500; // 5% drift triggers rebalance
    config.bump = ctx.bumps.portfolio_config;

    msg!(
        "ETF Executor initialized. Weights: AAPL {}bps / TSLA {}bps / NVDA {}bps",
        aaplx_weight_bps, tslax_weight_bps, nvdax_weight_bps
    );

    Ok(())
}
