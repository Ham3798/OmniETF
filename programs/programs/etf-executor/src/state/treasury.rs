use anchor_lang::prelude::*;

/// Global treasury state — holds the portfolio balances and accounting data.
/// PDA seeds: ["treasury"]
#[account]
#[derive(Debug)]
pub struct TreasuryState {
    /// Program authority (can call admin instructions)
    pub authority: Pubkey,
    /// ETFVault contract address on Base (20 bytes, EVM address)
    pub base_vault_address: [u8; 20],
    /// Total USDC (6 decimals) currently deployed in the portfolio
    pub total_usdc_deployed: u64,
    /// Mock AAPLx units held (6 decimals: 1_000_000 = 1.0 token)
    pub aaplx_units: u64,
    /// Mock TSLAx units held (6 decimals)
    pub tslax_units: u64,
    /// Mock NVDAx units held (6 decimals)
    pub nvdax_units: u64,
    /// Total mETF shares outstanding (mirrors Base chain, updated by coordinator)
    pub total_shares: u64,
    /// Last NAV per share in USDC (6 decimals). Reported to Base via coordinator.
    pub nav_per_share: u64,
    /// Running deposit sequence (maps to Base chain depositNonce)
    pub deposit_count: u64,
    /// Running redeem sequence
    pub redeem_count: u64,
    pub bump: u8,
}

impl TreasuryState {
    pub const LEN: usize = 8  // discriminator
        + 32   // authority
        + 20   // base_vault_address
        + 4    // padding to align u64
        + 8    // total_usdc_deployed
        + 8    // aaplx_units
        + 8    // tslax_units
        + 8    // nvdax_units
        + 8    // total_shares
        + 8    // nav_per_share
        + 8    // deposit_count
        + 8    // redeem_count
        + 1;   // bump
}
