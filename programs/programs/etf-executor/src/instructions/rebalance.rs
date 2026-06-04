use anchor_lang::prelude::*;
use crate::state::{TreasuryState, PortfolioConfig};
use crate::errors::EtfError;
use crate::instructions::execute_deposit::{update_nav, calc_portfolio_usdc};

#[derive(Accounts)]
pub struct Rebalance<'info> {
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

/// Rebalance portfolio to target weights via mock swaps.
/// Can also update target weights and/or prices in the same call.
pub fn handler(
    ctx: Context<Rebalance>,
    // Optional new weights (pass 0 to keep existing)
    new_aaplx_weight: u16,
    new_tslax_weight: u16,
    new_nvdax_weight: u16,
    // Optional new prices (pass 0 to keep existing)
    new_aaplx_price: u64,
    new_tslax_price: u64,
    new_nvdax_price: u64,
) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;
    let config = &mut ctx.accounts.portfolio_config;

    // Update prices if provided
    if new_aaplx_price > 0 { config.aaplx_price_usdc = new_aaplx_price; }
    if new_tslax_price > 0 { config.tslax_price_usdc = new_tslax_price; }
    if new_nvdax_price > 0 { config.nvdax_price_usdc = new_nvdax_price; }

    // Update weights if provided
    if new_aaplx_weight > 0 || new_tslax_weight > 0 || new_nvdax_weight > 0 {
        require!(
            (new_aaplx_weight as u32 + new_tslax_weight as u32 + new_nvdax_weight as u32) == 10_000,
            EtfError::InvalidWeights
        );
        config.aaplx_weight_bps = new_aaplx_weight;
        config.tslax_weight_bps = new_tslax_weight;
        config.nvdax_weight_bps = new_nvdax_weight;
    }

    // Rebalance: recalculate target units from total portfolio value
    let portfolio_usdc = calc_portfolio_usdc(treasury, config);
    if portfolio_usdc == 0 {
        return Ok(());
    }

    let target_aaplx_usdc = (portfolio_usdc as u128)
        .saturating_mul(config.aaplx_weight_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;

    let target_tslax_usdc = (portfolio_usdc as u128)
        .saturating_mul(config.tslax_weight_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;

    let target_nvdax_usdc = portfolio_usdc
        .saturating_sub(target_aaplx_usdc)
        .saturating_sub(target_tslax_usdc);

    // Convert target USDC values → token units (mock swap)
    let prev_aaplx = treasury.aaplx_units;
    let prev_tslax = treasury.tslax_units;
    let prev_nvdax = treasury.nvdax_units;

    treasury.aaplx_units = PortfolioConfig::usdc_to_units(target_aaplx_usdc, config.aaplx_price_usdc);
    treasury.tslax_units = PortfolioConfig::usdc_to_units(target_tslax_usdc, config.tslax_price_usdc);
    treasury.nvdax_units = PortfolioConfig::usdc_to_units(target_nvdax_usdc, config.nvdax_price_usdc);

    update_nav(treasury, config);

    msg!(
        "Rebalanced. AAPLx: {} → {} | TSLAx: {} → {} | NVDAx: {} → {}. NAV/share: {}",
        prev_aaplx, treasury.aaplx_units,
        prev_tslax, treasury.tslax_units,
        prev_nvdax, treasury.nvdax_units,
        treasury.nav_per_share,
    );

    Ok(())
}
