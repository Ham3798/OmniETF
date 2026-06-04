use anchor_lang::prelude::*;
use crate::state::{TreasuryState, PortfolioConfig};
use crate::errors::EtfError;
use crate::instructions::execute_deposit::{update_nav, calc_portfolio_usdc};

#[derive(Accounts)]
pub struct ExecuteRedeem<'info> {
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

/// Returns the USDC amount to send back to the user (coordinator bridges this to Base).
pub fn handler(
    ctx: Context<ExecuteRedeem>,
    shares_to_redeem: u64,
    redeem_id: u64,
) -> Result<u64> {
    let treasury = &mut ctx.accounts.treasury;
    let config = &ctx.accounts.portfolio_config;

    require!(shares_to_redeem > 0, EtfError::ZeroAmount);
    require!(treasury.total_shares >= shares_to_redeem, EtfError::InsufficientShares);

    let portfolio_usdc = calc_portfolio_usdc(treasury, config);

    // Proportional sell: redeem_ratio = shares_to_redeem / total_shares
    // usdc_out = portfolio_usdc * shares_to_redeem / total_shares
    let usdc_out = (portfolio_usdc as u128)
        .saturating_mul(shares_to_redeem as u128)
        .checked_div(treasury.total_shares as u128)
        .unwrap_or(0) as u64;

    require!(usdc_out > 0, EtfError::ZeroAmount);

    // Sell proportional tokens for each asset
    let aaplx_sell = (treasury.aaplx_units as u128)
        .saturating_mul(shares_to_redeem as u128)
        .checked_div(treasury.total_shares as u128)
        .unwrap_or(0) as u64;

    let tslax_sell = (treasury.tslax_units as u128)
        .saturating_mul(shares_to_redeem as u128)
        .checked_div(treasury.total_shares as u128)
        .unwrap_or(0) as u64;

    let nvdax_sell = (treasury.nvdax_units as u128)
        .saturating_mul(shares_to_redeem as u128)
        .checked_div(treasury.total_shares as u128)
        .unwrap_or(0) as u64;

    treasury.aaplx_units = treasury.aaplx_units.saturating_sub(aaplx_sell);
    treasury.tslax_units = treasury.tslax_units.saturating_sub(tslax_sell);
    treasury.nvdax_units = treasury.nvdax_units.saturating_sub(nvdax_sell);
    treasury.total_shares = treasury.total_shares.saturating_sub(shares_to_redeem);
    treasury.total_usdc_deployed = treasury.total_usdc_deployed.saturating_sub(usdc_out);
    treasury.redeem_count = treasury.redeem_count.saturating_add(1);

    update_nav(treasury, config);

    msg!(
        "Redeem #{}: {} shares → {} USDC (redeem_id={}). Sold {} AAPLx + {} TSLAx + {} NVDAx",
        treasury.redeem_count,
        shares_to_redeem,
        usdc_out,
        redeem_id,
        aaplx_sell,
        tslax_sell,
        nvdax_sell
    );

    Ok(usdc_out)
}
