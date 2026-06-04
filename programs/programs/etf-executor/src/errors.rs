use anchor_lang::prelude::*;

#[error_code]
pub enum EtfError {
    #[msg("Asset weights must sum to exactly 10000 basis points (100%)")]
    InvalidWeights,

    #[msg("Asset price must be greater than zero")]
    InvalidPrice,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Insufficient shares in treasury")]
    InsufficientShares,

    #[msg("Portfolio value is zero")]
    ZeroPortfolioValue,

    #[msg("Unauthorized: caller is not the treasury authority")]
    Unauthorized,

    #[msg("Arithmetic overflow")]
    Overflow,
}
