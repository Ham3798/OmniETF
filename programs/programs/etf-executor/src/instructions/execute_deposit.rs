use anchor_lang::prelude::*;
use crate::state::{TreasuryState, PortfolioConfig};
use crate::errors::EtfError;

#[derive(Accounts)]
pub struct ExecuteDeposit<'info> {
    #[account(
        mut,
        seeds = [b"treasury"],
        bump = treasury.bump,
        has_one = authority,
    )]
    pub treasury: Account<'info, TreasuryState>,

    #[account(
        seeds = [b"portfolio-config"],
        bump = portfolio_config.bump,
    )]
    pub portfolio_config: Account<'info, PortfolioConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<ExecuteDeposit>,
    usdc_amount: u64,
    deposit_id: u64,
    shares_minted: u64,
) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;
    let config = &ctx.accounts.portfolio_config;

    require!(usdc_amount > 0, EtfError::ZeroAmount);

    // Allocate USDC to each asset according to target weights
    let aaplx_usdc = (usdc_amount as u128)
        .saturating_mul(config.aaplx_weight_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;

    let tslax_usdc = (usdc_amount as u128)
        .saturating_mul(config.tslax_weight_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;

    // Assign remainder to NVDAx to avoid rounding dust
    let nvdax_usdc = usdc_amount.saturating_sub(aaplx_usdc).saturating_sub(tslax_usdc);

    // Mock swap: USDC → token units
    let new_aaplx = PortfolioConfig::usdc_to_units(aaplx_usdc, config.aaplx_price_usdc);
    let new_tslax = PortfolioConfig::usdc_to_units(tslax_usdc, config.tslax_price_usdc);
    let new_nvdax = PortfolioConfig::usdc_to_units(nvdax_usdc, config.nvdax_price_usdc);

    treasury.aaplx_units = treasury.aaplx_units.saturating_add(new_aaplx);
    treasury.tslax_units = treasury.tslax_units.saturating_add(new_tslax);
    treasury.nvdax_units = treasury.nvdax_units.saturating_add(new_nvdax);
    treasury.total_usdc_deployed = treasury.total_usdc_deployed.saturating_add(usdc_amount);
    treasury.total_shares = treasury.total_shares.saturating_add(shares_minted);
    treasury.deposit_count = treasury.deposit_count.saturating_add(1);

    // Recompute NAV per share
    update_nav(treasury, config);

    msg!(
        "Deposit #{}: {} USDC → {} AAPLx + {} TSLAx + {} NVDAx (deposit_id={})",
        treasury.deposit_count,
        usdc_amount,
        new_aaplx,
        new_tslax,
        new_nvdax,
        deposit_id
    );

    Ok(())
}

pub fn update_nav(treasury: &mut TreasuryState, config: &PortfolioConfig) {
    let portfolio_usdc = calc_portfolio_usdc(treasury, config);
    if treasury.total_shares > 0 {
        // nav_per_share = portfolio_value * 1e6 / total_shares (6 decimal USDC per share)
        treasury.nav_per_share = (portfolio_usdc as u128)
            .saturating_mul(1_000_000)
            .checked_div(treasury.total_shares as u128)
            .unwrap_or(1_000_000) as u64;
    } else {
        treasury.nav_per_share = 1_000_000;
    }
}

pub fn calc_portfolio_usdc(treasury: &TreasuryState, config: &PortfolioConfig) -> u64 {
    let aaplx_value = PortfolioConfig::units_to_usdc(treasury.aaplx_units, config.aaplx_price_usdc);
    let tslax_value = PortfolioConfig::units_to_usdc(treasury.tslax_units, config.tslax_price_usdc);
    let nvdax_value = PortfolioConfig::units_to_usdc(treasury.nvdax_units, config.nvdax_price_usdc);
    aaplx_value.saturating_add(tslax_value).saturating_add(nvdax_value)
}
