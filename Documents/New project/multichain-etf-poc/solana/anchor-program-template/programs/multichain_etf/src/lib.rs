use anchor_lang::prelude::*;

declare_id!("EtF111111111111111111111111111111111111111");

#[program]
pub mod multichain_etf {
    use super::*;

    pub fn initialize_fund(
        ctx: Context<InitializeFund>,
        bump: u8,
        weights_bps: Vec<u16>,
        symbols: Vec<String>,
    ) -> Result<()> {
        let fund = &mut ctx.accounts.fund;
        fund.admin = ctx.accounts.admin.key();
        fund.bump = bump;
        fund.weights_bps = weights_bps;
        fund.symbols = symbols;
        fund.last_nav_e6 = 0;
        fund.pending_bridge_action = 0;
        Ok(())
    }

    pub fn receive_bridged_usdc(ctx: Context<UpdateFund>, amount_e6: u64, bridge_action: u64) -> Result<()> {
        let fund = &mut ctx.accounts.fund;
        fund.pending_bridge_action = bridge_action;
        emit!(BridgeReceived {
            amount_e6,
            bridge_action,
        });
        Ok(())
    }

    pub fn allocate_portfolio(ctx: Context<UpdateFund>) -> Result<()> {
        let fund = &mut ctx.accounts.fund;
        emit!(AllocationExecuted {
            fund: fund.key(),
            last_nav_e6: fund.last_nav_e6,
        });
        Ok(())
    }

    pub fn sync_prices(ctx: Context<UpdateFund>, prices_e6: Vec<u64>, nav_e6: u64) -> Result<()> {
        let fund = &mut ctx.accounts.fund;
        fund.last_prices_e6 = prices_e6;
        fund.last_nav_e6 = nav_e6;
        emit!(NavSynced {
            nav_e6,
        });
        Ok(())
    }

    pub fn prepare_redemption(ctx: Context<UpdateFund>, redeem_assets_e6: u64, bridge_action: u64) -> Result<()> {
        let fund = &mut ctx.accounts.fund;
        fund.pending_bridge_action = bridge_action;
        emit!(RedemptionPrepared {
            redeem_assets_e6,
            bridge_action,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeFund<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = FundState::space_for(3, 3),
        seeds = [b"fund", admin.key().as_ref()],
        bump
    )]
    pub fund: Account<'info, FundState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFund<'info> {
    #[account(mut, has_one = admin)]
    pub fund: Account<'info, FundState>,
    pub admin: Signer<'info>,
}

#[account]
pub struct FundState {
    pub admin: Pubkey,
    pub bump: u8,
    pub weights_bps: Vec<u16>,
    pub symbols: Vec<String>,
    pub last_prices_e6: Vec<u64>,
    pub last_nav_e6: u64,
    pub pending_bridge_action: u64,
}

impl FundState {
    pub fn space_for(symbol_count: usize, symbol_len: usize) -> usize {
        8 + 32 + 1 + (4 + symbol_count * 2) + (4 + symbol_count * (4 + symbol_len)) + (4 + symbol_count * 8) + 8 + 8
    }
}

#[event]
pub struct BridgeReceived {
    pub amount_e6: u64,
    pub bridge_action: u64,
}

#[event]
pub struct AllocationExecuted {
    pub fund: Pubkey,
    pub last_nav_e6: u64,
}

#[event]
pub struct NavSynced {
    pub nav_e6: u64,
}

#[event]
pub struct RedemptionPrepared {
    pub redeem_assets_e6: u64,
    pub bridge_action: u64,
}
