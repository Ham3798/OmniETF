import { readFileSync } from "node:fs";
import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

await loadEnv();

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args["dry-run"] ?? process.env.CCTP_DRY_RUN);
const SOLANA_RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const SOLANA_WS = process.env.SOLANA_WS ?? "wss://api.devnet.solana.com";
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const SOLANA_KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH;

if (!dryRun && !SOLANA_PRIVATE_KEY && !SOLANA_KEYPAIR_PATH) {
  throw new Error("Set SOLANA_PRIVATE_KEY as a JSON byte array or SOLANA_KEYPAIR_PATH");
}

const TOKEN_MESSENGER_MINTER_PROGRAM = address(
  process.env.SOLANA_TOKEN_MESSENGER_MINTER_V2 ?? "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
);
const MESSAGE_TRANSMITTER_PROGRAM = address(
  process.env.SOLANA_MESSAGE_TRANSMITTER_V2 ?? "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
);
const USDC_MINT = address(process.env.SOLANA_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const ASSOCIATED_TOKEN_PROGRAM = address(
  process.env.SOLANA_ASSOCIATED_TOKEN_PROGRAM ?? "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

const amount = BigInt(args.amount ?? process.env.REDEEM_ASSETS_CLAIMABLE ?? process.env.AMOUNT ?? "0");
const destinationDomain = Number(
  args["destination-domain"] ?? process.env.REVERSE_CCTP_DESTINATION_DOMAIN ?? process.env.SOURCE_DOMAIN ?? "6",
);
const maxFee = BigInt(args["max-fee"] ?? process.env.REVERSE_CCTP_MAX_FEE ?? "0");
const minFinalityThreshold = Number(
  args["min-finality-threshold"] ?? process.env.REVERSE_CCTP_MIN_FINALITY_THRESHOLD ?? process.env.MIN_FINALITY_THRESHOLD ?? "1000",
);
const mintRecipientBytes32 =
  args["mint-recipient"] ??
  process.env.REVERSE_CCTP_MINT_RECIPIENT_BYTES32 ??
  evmAddressToBytes32(process.env.OMNIETF_ASYNC_VAULT);
const destinationCallerBytes32 =
  args["destination-caller"] ??
  process.env.REVERSE_CCTP_DESTINATION_CALLER_BYTES32 ??
  "0x0000000000000000000000000000000000000000000000000000000000000000";

if (amount <= 0n) throw new Error("Set positive REDEEM_ASSETS_CLAIMABLE or pass --amount <base units>");
if (!mintRecipientBytes32) {
  throw new Error("Set REVERSE_CCTP_MINT_RECIPIENT_BYTES32 or OMNIETF_ASYNC_VAULT");
}

const solanaKeypair =
  SOLANA_PRIVATE_KEY || SOLANA_KEYPAIR_PATH
    ? await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(SOLANA_PRIVATE_KEY ?? readFileSync(SOLANA_KEYPAIR_PATH, "utf8"))))
    : await generateKeyPairSigner();
const addressEncoder = getAddressEncoder();

const senderUsdcAccount = args["source-token-account"]
  ? address(args["source-token-account"])
  : process.env.SOLANA_USDC_TOKEN_ACCOUNT
    ? address(process.env.SOLANA_USDC_TOKEN_ACCOUNT)
    : await associatedTokenAccount(solanaKeypair.address, USDC_MINT);

const burnContext = await getBurnContext();
const instructionData = new Uint8Array(
  Buffer.concat([
    Buffer.from([215, 60, 61, 46, 114, 55, 128, 176]),
    u64(amount),
    u32(destinationDomain),
    bytes32ToBuffer(mintRecipientBytes32),
    bytes32ToBuffer(destinationCallerBytes32),
    u64(maxFee),
    u32(minFinalityThreshold),
  ]),
);

const depositForBurnIx = {
  programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
  accounts: [
    { address: solanaKeypair.address, role: 3, signer: solanaKeypair },
    { address: solanaKeypair.address, role: 3, signer: solanaKeypair },
    { address: burnContext.senderAuthorityPda, role: 0 },
    { address: senderUsdcAccount, role: 1 },
    { address: burnContext.denylistPda, role: 0 },
    { address: burnContext.messageTransmitter, role: 1 },
    { address: burnContext.tokenMessenger, role: 0 },
    { address: burnContext.remoteTokenMessenger, role: 0 },
    { address: burnContext.tokenMinter, role: 0 },
    { address: burnContext.localToken, role: 1 },
    { address: USDC_MINT, role: 1 },
    { address: burnContext.messageSentEventAccount.address, role: 3, signer: burnContext.messageSentEventAccount },
    { address: MESSAGE_TRANSMITTER_PROGRAM, role: 0 },
    { address: TOKEN_MESSENGER_MINTER_PROGRAM, role: 0 },
    { address: TOKEN_PROGRAM_ADDRESS, role: 0 },
    { address: SYSTEM_PROGRAM_ADDRESS, role: 0 },
    { address: burnContext.eventAuthority, role: 0 },
    { address: TOKEN_MESSENGER_MINTER_PROGRAM, role: 0 },
    { address: burnContext.messageTransmitterEventAuthority, role: 0 },
    { address: MESSAGE_TRANSMITTER_PROGRAM, role: 0 },
  ],
  data: instructionData,
};

console.log(
  JSON.stringify(
    {
      mode: "solana-cctp-v2-deposit-for-burn",
      payer: solanaKeypair.address,
      sourceTokenAccount: senderUsdcAccount,
      amount: amount.toString(),
      destinationDomain,
      mintRecipientBytes32,
      destinationCallerBytes32,
      maxFee: maxFee.toString(),
      minFinalityThreshold,
      messageSentEventAccount: burnContext.messageSentEventAccount.address,
      dryRun,
      instructionDataBytes: instructionData.length,
      accountCount: depositForBurnIx.accounts.length,
    },
    null,
    2,
  ),
);

if (dryRun) {
  process.exit(0);
}

const rpc = createSolanaRpc(SOLANA_RPC);
const rpcSubscriptions = createSolanaRpcSubscriptions(SOLANA_WS);
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(solanaKeypair, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstruction(depositForBurnIx, tx),
);
const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
console.log(`Solana CCTP burn tx: ${getSignatureFromTransaction(signedTransaction)}`);

async function getBurnContext() {
  const [senderAuthorityPda] = await getProgramDerivedAddress({
    programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
    seeds: [new TextEncoder().encode("sender_authority")],
  });
  const [denylistPda] = await getProgramDerivedAddress({
    programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
    seeds: [new TextEncoder().encode("denylist_account"), addressEncoder.encode(solanaKeypair.address)],
  });
  const [messageTransmitter] = await getProgramDerivedAddress({
    programAddress: MESSAGE_TRANSMITTER_PROGRAM,
    seeds: [new TextEncoder().encode("message_transmitter")],
  });
  const [tokenMessenger] = await getProgramDerivedAddress({
    programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
    seeds: [new TextEncoder().encode("token_messenger")],
  });
  const [remoteTokenMessenger] = await getProgramDerivedAddress({
    programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
    seeds: [new TextEncoder().encode("remote_token_messenger"), new TextEncoder().encode(String(destinationDomain))],
  });
  const [tokenMinter] = await getProgramDerivedAddress({
    programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
    seeds: [new TextEncoder().encode("token_minter")],
  });
  const [localToken] = await getProgramDerivedAddress({
    programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
    seeds: [new TextEncoder().encode("local_token"), addressEncoder.encode(USDC_MINT)],
  });
  const [eventAuthority] = await getProgramDerivedAddress({
    programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
    seeds: [new TextEncoder().encode("__event_authority")],
  });
  const [messageTransmitterEventAuthority] = await getProgramDerivedAddress({
    programAddress: MESSAGE_TRANSMITTER_PROGRAM,
    seeds: [new TextEncoder().encode("__event_authority")],
  });

  return {
    senderAuthorityPda,
    denylistPda,
    messageTransmitter,
    tokenMessenger,
    remoteTokenMessenger,
    tokenMinter,
    localToken,
    eventAuthority,
    messageTransmitterEventAuthority,
    messageSentEventAccount: await generateKeyPairSigner(),
  };
}

async function associatedTokenAccount(owner, mint) {
  const [account] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [addressEncoder.encode(owner), addressEncoder.encode(TOKEN_PROGRAM_ADDRESS), addressEncoder.encode(mint)],
  });
  return account;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(Number(value));
  return buffer;
}

function bytes32ToBuffer(value) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`Expected bytes32 hex: ${value}`);
  return Buffer.from(value.slice(2), "hex");
}

function evmAddressToBytes32(value) {
  if (!value) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`Invalid EVM address: ${value}`);
  return `0x${value.slice(2).padStart(64, "0").toLowerCase()}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}

async function loadEnv() {
  const { existsSync } = await import("node:fs");
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...parts] = trimmed.split("=");
    process.env[key] ??= parts.join("=");
  }
}
