#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

const MAGIC: u64 = 0x4f_4d_4e_49_45_54_46_31; // OMNIETF1
const STATE_SPACE: usize = 88;
const OFFSET_MAGIC: usize = 0;
const OFFSET_AUTHORITY: usize = 8;
const OFFSET_AAPLX: usize = 40;
const OFFSET_TSLAX: usize = 48;
const OFFSET_NVDAX: usize = 56;
const OFFSET_TOTAL: usize = 64;
const OFFSET_LAST_REQUEST: usize = 72;
const OFFSET_LAST_ACTION: usize = 80;
const BPS: u64 = 10_000;
const AAPLX_BPS: u64 = 4_000;
const TSLAX_BPS: u64 = 3_000;

#[derive(Clone, Copy)]
enum Instruction {
    Initialize,
    Allocate { request_id: u64, usdc_amount: u64 },
    SellProRata { request_id: u64, usdc_amount: u64 },
    Rebalance { request_id: u64 },
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = unpack_instruction(instruction_data)?;
    let account_info_iter = &mut accounts.iter();
    let state = next_account_info(account_info_iter)?;
    let authority = next_account_info(account_info_iter)?;

    if state.owner != program_id {
        msg!("state account is not owned by this program");
        return Err(ProgramError::IncorrectProgramId);
    }
    if state.data_len() < STATE_SPACE {
        msg!("state account too small");
        return Err(ProgramError::InvalidAccountData);
    }

    match instruction {
        Instruction::Initialize => initialize(state, authority),
        Instruction::Allocate { request_id, usdc_amount } => {
            require_authority(state, authority)?;
            allocate(state, request_id, usdc_amount)
        }
        Instruction::SellProRata { request_id, usdc_amount } => {
            require_authority(state, authority)?;
            sell_pro_rata(state, request_id, usdc_amount)
        }
        Instruction::Rebalance { request_id } => {
            require_authority(state, authority)?;
            rebalance(state, request_id)
        }
    }
}

fn initialize(state: &AccountInfo, authority: &AccountInfo) -> ProgramResult {
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut data = state.try_borrow_mut_data()?;
    let current_magic = read_u64(&data, OFFSET_MAGIC)?;
    if current_magic == MAGIC {
        msg!("portfolio state is already initialized");
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    if current_magic != 0 {
        msg!("portfolio state has unexpected discriminator");
        return Err(ProgramError::InvalidAccountData);
    }
    write_u64(&mut data, OFFSET_MAGIC, MAGIC)?;
    data[OFFSET_AUTHORITY..OFFSET_AUTHORITY + 32].copy_from_slice(authority.key.as_ref());
    write_u64(&mut data, OFFSET_AAPLX, 0)?;
    write_u64(&mut data, OFFSET_TSLAX, 0)?;
    write_u64(&mut data, OFFSET_NVDAX, 0)?;
    write_u64(&mut data, OFFSET_TOTAL, 0)?;
    write_u64(&mut data, OFFSET_LAST_REQUEST, 0)?;
    write_u64(&mut data, OFFSET_LAST_ACTION, 0)?;
    msg!("omnietf: initialized portfolio state");
    Ok(())
}

fn require_authority(state: &AccountInfo, authority: &AccountInfo) -> ProgramResult {
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let data = state.try_borrow_data()?;
    if read_u64(&data, OFFSET_MAGIC)? != MAGIC {
        return Err(ProgramError::UninitializedAccount);
    }
    if &data[OFFSET_AUTHORITY..OFFSET_AUTHORITY + 32] != authority.key.as_ref() {
        msg!("invalid portfolio authority");
        return Err(ProgramError::IllegalOwner);
    }
    Ok(())
}

fn allocate(state: &AccountInfo, request_id: u64, usdc_amount: u64) -> ProgramResult {
    let mut data = state.try_borrow_mut_data()?;
    let aaplx_add = checked_weight(usdc_amount, AAPLX_BPS)?;
    let tslax_add = checked_weight(usdc_amount, TSLAX_BPS)?;
    let nvdax_add = usdc_amount
        .checked_sub(aaplx_add)
        .and_then(|remaining| remaining.checked_sub(tslax_add))
        .ok_or(ProgramError::InvalidInstructionData)?;

    let aaplx = read_u64(&data, OFFSET_AAPLX)?.checked_add(aaplx_add).ok_or(ProgramError::InvalidInstructionData)?;
    let tslax = read_u64(&data, OFFSET_TSLAX)?.checked_add(tslax_add).ok_or(ProgramError::InvalidInstructionData)?;
    let nvdax = read_u64(&data, OFFSET_NVDAX)?.checked_add(nvdax_add).ok_or(ProgramError::InvalidInstructionData)?;
    write_values(&mut data, aaplx, tslax, nvdax, request_id, 1)?;
    msg!("omnietf: allocated request={} usdc={} total={}", request_id, usdc_amount, aaplx + tslax + nvdax);
    Ok(())
}

fn sell_pro_rata(state: &AccountInfo, request_id: u64, usdc_amount: u64) -> ProgramResult {
    let mut data = state.try_borrow_mut_data()?;
    let total = read_u64(&data, OFFSET_TOTAL)?;
    if total == 0 || usdc_amount > total {
        msg!("insufficient synthetic portfolio value");
        return Err(ProgramError::InsufficientFunds);
    }

    let aaplx = read_u64(&data, OFFSET_AAPLX)?;
    let tslax = read_u64(&data, OFFSET_TSLAX)?;
    let aaplx_sold = pro_rata(aaplx, usdc_amount, total)?;
    let tslax_sold = pro_rata(tslax, usdc_amount, total)?;
    let nvdax_sold = usdc_amount
        .checked_sub(aaplx_sold)
        .and_then(|remaining| remaining.checked_sub(tslax_sold))
        .ok_or(ProgramError::InvalidInstructionData)?;

    let new_aaplx = aaplx.checked_sub(aaplx_sold).ok_or(ProgramError::InvalidInstructionData)?;
    let new_tslax = tslax.checked_sub(tslax_sold).ok_or(ProgramError::InvalidInstructionData)?;
    let new_nvdax = read_u64(&data, OFFSET_NVDAX)?.checked_sub(nvdax_sold).ok_or(ProgramError::InvalidInstructionData)?;
    write_values(&mut data, new_aaplx, new_tslax, new_nvdax, request_id, 2)?;
    msg!("omnietf: sold request={} usdc={} total={}", request_id, usdc_amount, new_aaplx + new_tslax + new_nvdax);
    Ok(())
}

fn rebalance(state: &AccountInfo, request_id: u64) -> ProgramResult {
    let mut data = state.try_borrow_mut_data()?;
    let total = read_u64(&data, OFFSET_TOTAL)?;
    let aaplx = checked_weight(total, AAPLX_BPS)?;
    let tslax = checked_weight(total, TSLAX_BPS)?;
    let nvdax = total
        .checked_sub(aaplx)
        .and_then(|remaining| remaining.checked_sub(tslax))
        .ok_or(ProgramError::InvalidInstructionData)?;
    write_values(&mut data, aaplx, tslax, nvdax, request_id, 3)?;
    msg!("omnietf: rebalanced request={} total={}", request_id, total);
    Ok(())
}

fn write_values(
    data: &mut [u8],
    aaplx: u64,
    tslax: u64,
    nvdax: u64,
    request_id: u64,
    action: u64,
) -> ProgramResult {
    let total = aaplx.checked_add(tslax).and_then(|value| value.checked_add(nvdax)).ok_or(ProgramError::InvalidInstructionData)?;
    write_u64(data, OFFSET_AAPLX, aaplx)?;
    write_u64(data, OFFSET_TSLAX, tslax)?;
    write_u64(data, OFFSET_NVDAX, nvdax)?;
    write_u64(data, OFFSET_TOTAL, total)?;
    write_u64(data, OFFSET_LAST_REQUEST, request_id)?;
    write_u64(data, OFFSET_LAST_ACTION, action)?;
    Ok(())
}

fn unpack_instruction(input: &[u8]) -> Result<Instruction, ProgramError> {
    let (&tag, rest) = input.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => Ok(Instruction::Initialize),
        1 => Ok(Instruction::Allocate { request_id: read_u64_at(rest, 0)?, usdc_amount: read_u64_at(rest, 8)? }),
        2 => Ok(Instruction::SellProRata { request_id: read_u64_at(rest, 0)?, usdc_amount: read_u64_at(rest, 8)? }),
        3 => Ok(Instruction::Rebalance { request_id: read_u64_at(rest, 0)? }),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn checked_weight(amount: u64, weight_bps: u64) -> Result<u64, ProgramError> {
    let weighted = (amount as u128)
        .checked_mul(weight_bps as u128)
        .and_then(|value| value.checked_div(BPS as u128))
        .ok_or(ProgramError::InvalidInstructionData)?;
    u64::try_from(weighted).map_err(|_| ProgramError::InvalidInstructionData)
}

fn pro_rata(balance: u64, amount: u64, total: u64) -> Result<u64, ProgramError> {
    let value = (balance as u128)
        .checked_mul(amount as u128)
        .and_then(|value| value.checked_div(total as u128))
        .ok_or(ProgramError::InvalidInstructionData)?;
    u64::try_from(value).map_err(|_| ProgramError::InvalidInstructionData)
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    read_u64_at(data, offset)
}

fn read_u64_at(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let end = offset.checked_add(8).ok_or(ProgramError::InvalidInstructionData)?;
    let bytes = data.get(offset..end).ok_or(ProgramError::InvalidInstructionData)?;
    Ok(u64::from_le_bytes(bytes.try_into().map_err(|_| ProgramError::InvalidInstructionData)?))
}

fn write_u64(data: &mut [u8], offset: usize, value: u64) -> ProgramResult {
    let end = offset.checked_add(8).ok_or(ProgramError::InvalidInstructionData)?;
    let target = data.get_mut(offset..end).ok_or(ProgramError::InvalidInstructionData)?;
    target.copy_from_slice(&value.to_le_bytes());
    Ok(())
}
