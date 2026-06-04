use anchor_lang::prelude::*;

declare_id!("4LaatT5FGgWMkFfT3zLUSEnsaWegk52a2nEwk8VRR881");

pub const EXTERNAL_EXECUTION_CONFIG_SEED: &[u8] = b"external_execution_config";
pub const APPROVED_SENDER_SEED: &[u8] = b"approved_ccip_sender";
pub const TOKEN_ADMIN_SEED: &[u8] = b"receiver_token_admin";
pub const ALLOWED_OFFRAMP: &[u8] = b"allowed_offramp";
pub const STATE: &[u8] = b"state";
pub const MAX_TRACKED_MESSAGES: usize = 16;

#[program]
pub mod omnietf_custody {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, router: Pubkey) -> Result<()> {
        ctx.accounts.state.init(ctx.accounts.authority.key(), router)
    }

    pub fn update_router(ctx: Context<UpdateConfig>, router: Pubkey) -> Result<()> {
        ctx.accounts.state.update_router(ctx.accounts.authority.key(), router)
    }

    pub fn approve_sender(
        _ctx: Context<ApproveSender>,
        _chain_selector: u64,
        _remote_sender: Vec<u8>,
    ) -> Result<()> {
        Ok(())
    }

    pub fn unapprove_sender(
        _ctx: Context<UnapproveSender>,
        _chain_selector: u64,
        _remote_sender: Vec<u8>,
    ) -> Result<()> {
        Ok(())
    }

    pub fn transfer_ownership(ctx: Context<UpdateConfig>, proposed_owner: Pubkey) -> Result<()> {
        ctx.accounts
            .state
            .transfer_ownership(ctx.accounts.authority.key(), proposed_owner)
    }

    pub fn accept_ownership(ctx: Context<AcceptOwnership>) -> Result<()> {
        ctx.accounts.state.accept_ownership(ctx.accounts.authority.key())
    }

    pub fn ccip_receive(ctx: Context<CcipReceive>, message: Any2SVMMessage) -> Result<()> {
        let state = &mut ctx.accounts.state;
        require!(
            !state.has_processed(message.message_id),
            OmniETFCustodyError::DuplicateMessage
        );

        let payload = CustodyPayload::decode(&message.data)?;
        let total_token_amount = message
            .token_amounts
            .iter()
            .try_fold(0u64, |sum, item| sum.checked_add(item.amount))
            .ok_or(OmniETFCustodyError::MathOverflow)?;

        state.record_message(message.message_id, message.source_chain_selector, payload, total_token_amount)?;

        emit!(MessageReceived {
            message_id: message.message_id,
            source_chain_selector: message.source_chain_selector,
            sender: message.sender,
            payload_kind: payload.kind(),
            token_amount: total_token_amount,
        });

        Ok(())
    }

    pub fn record_manual_allocation(
        ctx: Context<UpdateConfig>,
        aapl_units: u64,
        tsla_units: u64,
        nvda_units: u64,
    ) -> Result<()> {
        ctx.accounts
            .state
            .record_manual_allocation(ctx.accounts.authority.key(), aapl_units, tsla_units, nvda_units)
    }

    pub fn assert_token_admin(_ctx: Context<AssertTokenAdmin>) -> Result<()> {
        Ok(())
    }
}

const ANCHOR_DISCRIMINATOR: usize = 8;

#[derive(Accounts, Debug)]
pub struct Initialize<'info> {
    #[account(
        init,
        seeds = [STATE],
        bump,
        payer = authority,
        space = ANCHOR_DISCRIMINATOR + CustodyState::INIT_SPACE,
    )]
    pub state: Account<'info, CustodyState>,
    #[account(
        init,
        seeds = [TOKEN_ADMIN_SEED],
        bump,
        payer = authority,
        space = ANCHOR_DISCRIMINATOR,
    )]
    /// CHECK: PDA signer used as authority for token accounts owned by the custody program.
    pub token_admin: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Debug)]
#[instruction(message: Any2SVMMessage)]
pub struct CcipReceive<'info> {
    #[account(
        seeds = [EXTERNAL_EXECUTION_CONFIG_SEED, crate::ID.as_ref()],
        bump,
        seeds::program = offramp_program.key(),
    )]
    pub authority: Signer<'info>,

    /// CHECK: OffRamp program used to derive and validate the CCIP execution signer PDA.
    pub offramp_program: UncheckedAccount<'info>,

    /// CHECK: Router-owned PDA that proves the OffRamp is allowed for this source chain.
    #[account(
        owner = state.router @ OmniETFCustodyError::InvalidCaller,
        seeds = [
            ALLOWED_OFFRAMP,
            message.source_chain_selector.to_le_bytes().as_ref(),
            offramp_program.key().as_ref(),
        ],
        bump,
        seeds::program = state.router,
    )]
    pub allowed_offramp: UncheckedAccount<'info>,

    #[account(
        seeds = [
            APPROVED_SENDER_SEED,
            message.source_chain_selector.to_le_bytes().as_ref(),
            &[message.sender.len() as u8],
            &message.sender,
        ],
        bump,
    )]
    pub approved_sender: Account<'info, ApprovedSender>,

    #[account(mut, seeds = [STATE], bump)]
    pub state: Account<'info, CustodyState>,
}

#[derive(Accounts, Debug)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [STATE], bump)]
    pub state: Account<'info, CustodyState>,
    #[account(address = state.owner @ OmniETFCustodyError::OnlyOwner)]
    pub authority: Signer<'info>,
}

#[derive(Accounts, Debug)]
pub struct AcceptOwnership<'info> {
    #[account(mut, seeds = [STATE], bump)]
    pub state: Account<'info, CustodyState>,
    #[account(address = state.proposed_owner @ OmniETFCustodyError::OnlyProposedOwner)]
    pub authority: Signer<'info>,
}

#[derive(Accounts, Debug)]
#[instruction(chain_selector: u64, remote_sender: Vec<u8>)]
pub struct ApproveSender<'info> {
    #[account(seeds = [STATE], bump)]
    pub state: Account<'info, CustodyState>,
    #[account(
        init,
        seeds = [
            APPROVED_SENDER_SEED,
            chain_selector.to_le_bytes().as_ref(),
            &[remote_sender.len() as u8],
            &remote_sender,
        ],
        bump,
        payer = authority,
        space = ANCHOR_DISCRIMINATOR + ApprovedSender::INIT_SPACE,
    )]
    pub approved_sender: Account<'info, ApprovedSender>,
    #[account(mut, address = state.owner @ OmniETFCustodyError::OnlyOwner)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Debug)]
#[instruction(chain_selector: u64, remote_sender: Vec<u8>)]
pub struct UnapproveSender<'info> {
    #[account(mut, seeds = [STATE], bump)]
    pub state: Account<'info, CustodyState>,
    #[account(
        mut,
        seeds = [
            APPROVED_SENDER_SEED,
            chain_selector.to_le_bytes().as_ref(),
            &[remote_sender.len() as u8],
            &remote_sender,
        ],
        bump,
        close = authority,
    )]
    pub approved_sender: Account<'info, ApprovedSender>,
    #[account(mut, address = state.owner @ OmniETFCustodyError::OnlyOwner)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts, Debug)]
pub struct AssertTokenAdmin<'info> {
    #[account(seeds = [TOKEN_ADMIN_SEED], bump)]
    /// CHECK: PDA signer intended to own custody token accounts.
    pub token_admin: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace, Default, Debug)]
pub struct CustodyState {
    pub owner: Pubkey,
    pub proposed_owner: Pubkey,
    pub router: Pubkey,
    pub message_count: u64,
    pub total_received_units: u64,
    pub total_redeem_units: u64,
    pub aapl_units: u64,
    pub tsla_units: u64,
    pub nvda_units: u64,
    pub last_source_chain_selector: u64,
    pub last_message_id: [u8; 32],
    pub processed_message_ids: [[u8; 32]; MAX_TRACKED_MESSAGES],
    pub processed_cursor: u8,
}

impl CustodyState {
    pub fn init(&mut self, owner: Pubkey, router: Pubkey) -> Result<()> {
        require_keys_eq!(self.owner, Pubkey::default());
        require_keys_neq!(router, Pubkey::default(), OmniETFCustodyError::InvalidRouter);
        self.owner = owner;
        self.router = router;
        Ok(())
    }

    pub fn update_router(&mut self, owner: Pubkey, router: Pubkey) -> Result<()> {
        require_keys_eq!(self.owner, owner, OmniETFCustodyError::OnlyOwner);
        require_keys_neq!(router, Pubkey::default(), OmniETFCustodyError::InvalidRouter);
        self.router = router;
        Ok(())
    }

    pub fn transfer_ownership(&mut self, owner: Pubkey, proposed_owner: Pubkey) -> Result<()> {
        require_keys_eq!(self.owner, owner, OmniETFCustodyError::OnlyOwner);
        require!(
            proposed_owner != self.owner && proposed_owner != Pubkey::default(),
            OmniETFCustodyError::InvalidProposedOwner
        );
        self.proposed_owner = proposed_owner;
        Ok(())
    }

    pub fn accept_ownership(&mut self, proposed_owner: Pubkey) -> Result<()> {
        require_keys_eq!(
            self.proposed_owner,
            proposed_owner,
            OmniETFCustodyError::OnlyProposedOwner
        );
        self.owner = std::mem::take(&mut self.proposed_owner);
        Ok(())
    }

    pub fn record_message(
        &mut self,
        message_id: [u8; 32],
        source_chain_selector: u64,
        payload: CustodyPayload,
        bridged_units: u64,
    ) -> Result<()> {
        self.message_count = self
            .message_count
            .checked_add(1)
            .ok_or(OmniETFCustodyError::MathOverflow)?;
        self.total_received_units = self
            .total_received_units
            .checked_add(bridged_units)
            .ok_or(OmniETFCustodyError::MathOverflow)?;
        self.last_source_chain_selector = source_chain_selector;
        self.last_message_id = message_id;
        self.remember_message(message_id);

        match payload {
            CustodyPayload::AllocateBasket {
                aapl_units,
                tsla_units,
                nvda_units,
            } => {
                self.aapl_units = self
                    .aapl_units
                    .checked_add(aapl_units)
                    .ok_or(OmniETFCustodyError::MathOverflow)?;
                self.tsla_units = self
                    .tsla_units
                    .checked_add(tsla_units)
                    .ok_or(OmniETFCustodyError::MathOverflow)?;
                self.nvda_units = self
                    .nvda_units
                    .checked_add(nvda_units)
                    .ok_or(OmniETFCustodyError::MathOverflow)?;
            }
            CustodyPayload::Redeem { units } => {
                self.total_redeem_units = self
                    .total_redeem_units
                    .checked_add(units)
                    .ok_or(OmniETFCustodyError::MathOverflow)?;
            }
            CustodyPayload::Noop => {}
        }

        Ok(())
    }

    pub fn record_manual_allocation(
        &mut self,
        owner: Pubkey,
        aapl_units: u64,
        tsla_units: u64,
        nvda_units: u64,
    ) -> Result<()> {
        require_keys_eq!(self.owner, owner, OmniETFCustodyError::OnlyOwner);
        self.aapl_units = aapl_units;
        self.tsla_units = tsla_units;
        self.nvda_units = nvda_units;
        Ok(())
    }

    pub fn has_processed(&self, message_id: [u8; 32]) -> bool {
        self.processed_message_ids.iter().any(|item| *item == message_id)
    }

    fn remember_message(&mut self, message_id: [u8; 32]) {
        let index = usize::from(self.processed_cursor) % MAX_TRACKED_MESSAGES;
        self.processed_message_ids[index] = message_id;
        self.processed_cursor = ((index + 1) % MAX_TRACKED_MESSAGES) as u8;
    }
}

#[account]
#[derive(InitSpace, Default, Debug)]
pub struct ApprovedSender {}

#[derive(Debug, Clone, Copy, AnchorSerialize, AnchorDeserialize)]
pub enum CustodyPayload {
    Noop,
    AllocateBasket {
        aapl_units: u64,
        tsla_units: u64,
        nvda_units: u64,
    },
    Redeem {
        units: u64,
    },
}

impl CustodyPayload {
    pub fn decode(data: &[u8]) -> Result<Self> {
        if data.is_empty() {
            return Ok(Self::Noop);
        }

        match data[0] {
            0 => Ok(Self::Noop),
            1 => {
                require!(data.len() == 25, OmniETFCustodyError::InvalidPayload);
                Ok(Self::AllocateBasket {
                    aapl_units: read_u64(&data[1..9])?,
                    tsla_units: read_u64(&data[9..17])?,
                    nvda_units: read_u64(&data[17..25])?,
                })
            }
            2 => {
                require!(data.len() == 9, OmniETFCustodyError::InvalidPayload);
                Ok(Self::Redeem {
                    units: read_u64(&data[1..9])?,
                })
            }
            _ => err!(OmniETFCustodyError::InvalidPayload),
        }
    }

    pub fn kind(&self) -> u8 {
        match self {
            Self::Noop => 0,
            Self::AllocateBasket { .. } => 1,
            Self::Redeem { .. } => 2,
        }
    }
}

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct Any2SVMMessage {
    pub message_id: [u8; 32],
    pub source_chain_selector: u64,
    pub sender: Vec<u8>,
    pub data: Vec<u8>,
    pub token_amounts: Vec<SVMTokenAmount>,
}

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize, Default)]
pub struct SVMTokenAmount {
    pub token: Pubkey,
    pub amount: u64,
}

#[event]
pub struct MessageReceived {
    pub message_id: [u8; 32],
    pub source_chain_selector: u64,
    pub sender: Vec<u8>,
    pub payload_kind: u8,
    pub token_amount: u64,
}

#[error_code]
pub enum OmniETFCustodyError {
    #[msg("Invalid router address")]
    InvalidRouter,
    #[msg("Caller is not an allowed CCIP OffRamp")]
    InvalidCaller,
    #[msg("Address is not owner")]
    OnlyOwner,
    #[msg("Address is not proposed owner")]
    OnlyProposedOwner,
    #[msg("Proposed owner is invalid")]
    InvalidProposedOwner,
    #[msg("CCIP message was already processed recently")]
    DuplicateMessage,
    #[msg("Custody payload is invalid")]
    InvalidPayload,
    #[msg("Math overflow")]
    MathOverflow,
}

fn read_u64(bytes: &[u8]) -> Result<u64> {
    let raw: [u8; 8] = bytes.try_into().map_err(|_| OmniETFCustodyError::InvalidPayload)?;
    Ok(u64::from_le_bytes(raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_allocate_payload() {
        let mut data = vec![1u8];
        data.extend_from_slice(&10u64.to_le_bytes());
        data.extend_from_slice(&20u64.to_le_bytes());
        data.extend_from_slice(&30u64.to_le_bytes());

        match CustodyPayload::decode(&data).unwrap() {
            CustodyPayload::AllocateBasket {
                aapl_units,
                tsla_units,
                nvda_units,
            } => {
                assert_eq!(aapl_units, 10);
                assert_eq!(tsla_units, 20);
                assert_eq!(nvda_units, 30);
            }
            _ => panic!("unexpected payload"),
        }
    }

    #[test]
    fn records_messages_and_rejects_recent_duplicates() {
        let owner = Pubkey::new_unique();
        let router = Pubkey::new_unique();
        let mut state = CustodyState::default();
        state.init(owner, router).unwrap();

        let id = [7u8; 32];
        state
            .record_message(
                id,
                10344971235874465080,
                CustodyPayload::AllocateBasket {
                    aapl_units: 4,
                    tsla_units: 3,
                    nvda_units: 3,
                },
                10,
            )
            .unwrap();

        assert!(state.has_processed(id));
        assert_eq!(state.total_received_units, 10);
        assert_eq!(state.aapl_units, 4);
        assert_eq!(state.tsla_units, 3);
        assert_eq!(state.nvda_units, 3);
    }
}
