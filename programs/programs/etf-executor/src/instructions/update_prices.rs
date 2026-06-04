use anchor_lang::prelude::*;
use crate::state::{TreasuryState, PortfolioConfig};
use crate::errors::EtfError;
use crate::instructions::execute_deposit::update_nav;

#[derive(Accounts)]
pub struct UpdatePrices<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
        has_one = authority,
    )]
    pub treasury: Account<'info, TreasuryState>,

    #[account(
        mut,
        seeds = [b"portfolio-config"],
        bump = portfolio_config.bump,
    )]
    pub portfolio_config: Account<'info, PortfolioConfig>,

    pub authority: Signer<'info>,
}

/// Update mock asset prices. Called by the coordinator to simulate price changes.
/// In production this would be replaced by an on-chain oracle (e.g., Pyth).
pub fn handler(
    ctx: Context<UpdatePrices>,
    aaplx_price: u64,
    tslax_price: u64,
    nvdax_price: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.portfolio_config;
    let treasury = &mut ctx.accounts.treasury;

    require!(aaplx_price > 0 && tslax_price > 0 && nvdax_price > 0, EtfError::InvalidPrice);

    config.aaplx_price_usdc = aaplx_price;
    config.tslax_price_usdc = tslax_price;
    config.nvdax_price_usdc = nvdax_price;

    // Recompute NAV with new prices
    update_nav(treasury, config);

    msg!(
        "Prices updated. AAPLx: {} | TSLAx: {} | NVDAx: {} | NAV/share: {}",
        aaplx_price, tslax_price, nvdax_price, treasury.nav_per_share
    );

    Ok(())
}
