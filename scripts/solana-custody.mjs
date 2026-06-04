import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(
  process.env.SOLANA_CUSTODY_PROGRAM_ID ?? "4LaatT5FGgWMkFfT3zLUSEnsaWegk52a2nEwk8VRR881",
);
const CCIP_SOLANA_DEVNET_ROUTER = new PublicKey(
  process.env.CCIP_SOLANA_DEVNET_ROUTER ?? "Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C",
);

const STATE_SEED = Buffer.from("state");
const TOKEN_ADMIN_SEED = Buffer.from("receiver_token_admin");
const APPROVED_SENDER_SEED = Buffer.from("approved_ccip_sender");

function env(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value == null || value === "") throw new Error(`${name} is required`);
  return String(value).replace(/^"|"$/g, "");
}

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function discriminator(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function u64le(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function vec(bytes) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function evmAddressBytes(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }
  return Buffer.from(address.slice(2), "hex");
}

async function send(connection, payer, instruction) {
  const tx = new Transaction().add(instruction);
  return sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
    skipPreflight: false,
  });
}

function deriveState() {
  return PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID)[0];
}

function deriveTokenAdmin() {
  return PublicKey.findProgramAddressSync([TOKEN_ADMIN_SEED], PROGRAM_ID)[0];
}

function deriveApprovedSender(chainSelector, remoteSender) {
  return PublicKey.findProgramAddressSync(
    [
      APPROVED_SENDER_SEED,
      u64le(chainSelector),
      Buffer.from([remoteSender.length]),
      remoteSender,
    ],
    PROGRAM_ID,
  )[0];
}

async function initialize(connection, payer) {
  const state = deriveState();
  const tokenAdmin = deriveTokenAdmin();
  const existing = await connection.getAccountInfo(state, "confirmed");
  if (existing) {
    console.log(`state=${state.toBase58()}`);
    console.log(`tokenAdmin=${tokenAdmin.toBase58()}`);
    console.log("initialize=already-initialized");
    return;
  }

  const data = Buffer.concat([discriminator("initialize"), CCIP_SOLANA_DEVNET_ROUTER.toBuffer()]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: state, isSigner: false, isWritable: true },
      { pubkey: tokenAdmin, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const signature = await send(connection, payer, ix);
  console.log(`state=${state.toBase58()}`);
  console.log(`tokenAdmin=${tokenAdmin.toBase58()}`);
  console.log(`initialize=${signature}`);
}

async function approveSender(connection, payer, chainSelector, evmSender) {
  const remoteSender = evmAddressBytes(evmSender);
  const state = deriveState();
  const approvedSender = deriveApprovedSender(chainSelector, remoteSender);
  const existing = await connection.getAccountInfo(approvedSender, "confirmed");
  if (existing) {
    console.log(`approvedSender=${approvedSender.toBase58()}`);
    console.log("approveSender=already-approved");
    return;
  }

  const data = Buffer.concat([
    discriminator("approve_sender"),
    u64le(chainSelector),
    vec(remoteSender),
  ]);
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: state, isSigner: false, isWritable: false },
      { pubkey: approvedSender, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const signature = await send(connection, payer, ix);
  console.log(`approvedSender=${approvedSender.toBase58()}`);
  console.log(`approveSender=${signature}`);
}

async function show(connection) {
  const state = deriveState();
  const tokenAdmin = deriveTokenAdmin();
  const info = await connection.getAccountInfo(state, "confirmed");
  console.log(`program=${PROGRAM_ID.toBase58()}`);
  console.log(`state=${state.toBase58()}`);
  console.log(`tokenAdmin=${tokenAdmin.toBase58()}`);
  console.log(`router=${CCIP_SOLANA_DEVNET_ROUTER.toBase58()}`);
  console.log(`stateExists=${Boolean(info)}`);
  if (info) {
    console.log(`stateLamports=${info.lamports}`);
    const data = info.data;
    let offset = 8 + 32 + 32 + 32;
    const readU64 = () => {
      const value = data.readBigUInt64LE(offset);
      offset += 8;
      return value;
    };
    const messageCount = readU64();
    const totalReceivedUnits = readU64();
    const totalRedeemUnits = readU64();
    const aaplUnits = readU64();
    const tslaUnits = readU64();
    const nvdaUnits = readU64();
    const lastSourceChainSelector = readU64();
    const lastMessageId = `0x${data.subarray(offset, offset + 32).toString("hex")}`;
    console.log(`messageCount=${messageCount}`);
    console.log(`totalReceivedUnits=${totalReceivedUnits}`);
    console.log(`totalRedeemUnits=${totalRedeemUnits}`);
    console.log(`aaplUnits=${aaplUnits}`);
    console.log(`tslaUnits=${tslaUnits}`);
    console.log(`nvdaUnits=${nvdaUnits}`);
    console.log(`lastSourceChainSelector=${lastSourceChainSelector}`);
    console.log(`lastMessageId=${lastMessageId}`);
  }
}

async function main() {
  const command = process.argv[2] ?? "show";
  const connection = new Connection(env("SOLANA_RPC", "https://api.devnet.solana.com"), "confirmed");
  const payer = loadKeypair(env("SOLANA_KEYPAIR_PATH"));

  if (command === "initialize") return initialize(connection, payer);
  if (command === "approve-sender") {
    const chainSelector = process.argv[3] ?? env("BASE_SEPOLIA_CHAIN_SELECTOR", "10344971235874465080");
    const evmSender = process.argv[4] ?? env("CCIP_BASE_SENDER");
    return approveSender(connection, payer, chainSelector, evmSender);
  }
  if (command === "show") return show(connection);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
