import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
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

const SOURCE_DOMAIN = Number(process.env.SOURCE_DOMAIN ?? "6");
const SOURCE_TX = process.argv[2] ?? process.env.CCTP_SOURCE_TX;
const SOLANA_RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const SOLANA_WS = process.env.SOLANA_WS ?? "wss://api.devnet.solana.com";
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
const SOLANA_KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH;

if (!SOURCE_TX) throw new Error("Set CCTP_SOURCE_TX or pass tx hash as first argument");
if (!SOLANA_PRIVATE_KEY && !SOLANA_KEYPAIR_PATH) {
  throw new Error("Set SOLANA_PRIVATE_KEY as a JSON byte array or SOLANA_KEYPAIR_PATH");
}

const MESSAGE_TRANSMITTER_PROGRAM = address(
  process.env.SOLANA_MESSAGE_TRANSMITTER_V2 ?? "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
);
const TOKEN_MESSENGER_MINTER_PROGRAM = address(
  process.env.SOLANA_TOKEN_MESSENGER_MINTER_V2 ?? "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
);
const USDC_MINT = address(process.env.SOLANA_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const ASSOCIATED_TOKEN_PROGRAM = address(
  process.env.SOLANA_ASSOCIATED_TOKEN_PROGRAM ?? "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

const attestationData = await fetchAttestation(SOURCE_DOMAIN, SOURCE_TX);
if (attestationData.status !== "complete") {
  throw new Error(`Attestation is not complete: ${attestationData.status} ${attestationData.delayReason ?? ""}`);
}

const rpc = createSolanaRpc(SOLANA_RPC);
const rpcSubscriptions = createSolanaRpcSubscriptions(SOLANA_WS);
const keypairBytes = SOLANA_PRIVATE_KEY ?? readFileSync(SOLANA_KEYPAIR_PATH, "utf8");
const solanaKeypair = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(keypairBytes)));
const addressEncoder = getAddressEncoder();

const messageBytes = Buffer.from(attestationData.message.slice(2), "hex");
const attestationBytes = Buffer.from(attestationData.attestation.slice(2), "hex");
const messageBody = messageBytes.slice(148);
const mintRecipientBytes = messageBody.slice(36, 68);
const mintRecipient = address(bs58Encode(mintRecipientBytes));

const [messageTransmitter] = await getProgramDerivedAddress({
  programAddress: MESSAGE_TRANSMITTER_PROGRAM,
  seeds: [new TextEncoder().encode("message_transmitter")],
});
const [authorityPda] = await getProgramDerivedAddress({
  programAddress: MESSAGE_TRANSMITTER_PROGRAM,
  seeds: [new TextEncoder().encode("message_transmitter_authority"), addressEncoder.encode(TOKEN_MESSENGER_MINTER_PROGRAM)],
});

const nonceBytes = messageBytes.slice(12, 44);
const [usedNonces] = await getProgramDerivedAddress({
  programAddress: MESSAGE_TRANSMITTER_PROGRAM,
  seeds: [new TextEncoder().encode("used_nonce"), nonceBytes],
});

const [tokenMessenger] = await getProgramDerivedAddress({
  programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
  seeds: [new TextEncoder().encode("token_messenger")],
});
const [remoteTokenMessenger] = await getProgramDerivedAddress({
  programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
  seeds: [new TextEncoder().encode("remote_token_messenger"), new TextEncoder().encode(String(SOURCE_DOMAIN))],
});
const [tokenMinter] = await getProgramDerivedAddress({
  programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
  seeds: [new TextEncoder().encode("token_minter")],
});
const [localToken] = await getProgramDerivedAddress({
  programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
  seeds: [new TextEncoder().encode("local_token"), addressEncoder.encode(USDC_MINT)],
});

const sourceTokenBytes = messageBody.slice(4, 36);
const [tokenPair] = await getProgramDerivedAddress({
  programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
  seeds: [new TextEncoder().encode("token_pair"), new TextEncoder().encode(String(SOURCE_DOMAIN)), sourceTokenBytes],
});
const [custody] = await getProgramDerivedAddress({
  programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
  seeds: [new TextEncoder().encode("custody"), addressEncoder.encode(USDC_MINT)],
});
const [eventAuthority] = await getProgramDerivedAddress({
  programAddress: MESSAGE_TRANSMITTER_PROGRAM,
  seeds: [new TextEncoder().encode("__event_authority")],
});
const [tokenProgramEventAuthority] = await getProgramDerivedAddress({
  programAddress: TOKEN_MESSENGER_MINTER_PROGRAM,
  seeds: [new TextEncoder().encode("__event_authority")],
});
const tokenMessengerInfo = await rpc.getAccountInfo(tokenMessenger, { encoding: "base64" }).send();
if (!tokenMessengerInfo.value) throw new Error(`Token messenger account not found: ${tokenMessenger}`);
const tokenMessengerData = Buffer.from(tokenMessengerInfo.value.data[0], "base64");
const feeRecipient = address(bs58Encode(tokenMessengerData.slice(109, 141)));
const [feeRecipientTokenAccount] = await getProgramDerivedAddress({
  programAddress: ASSOCIATED_TOKEN_PROGRAM,
  seeds: [addressEncoder.encode(feeRecipient), addressEncoder.encode(TOKEN_PROGRAM_ADDRESS), addressEncoder.encode(USDC_MINT)],
});

const recipientInfo = await rpc.getAccountInfo(mintRecipient, { encoding: "base64" }).send();
if (!recipientInfo.value || recipientInfo.value.owner !== TOKEN_PROGRAM_ADDRESS) {
  throw new Error(
    `Mint recipient must be an existing SPL token account for Solana CCTP receiveMessage. ` +
      `Got ${mintRecipient}, owner ${recipientInfo.value?.owner ?? "missing"}.`,
  );
}

const discriminator = crypto.createHash("sha256").update("global:receive_message").digest().slice(0, 8);
const messageLenBuffer = Buffer.alloc(4);
messageLenBuffer.writeUInt32LE(messageBytes.length);
const attestationLenBuffer = Buffer.alloc(4);
attestationLenBuffer.writeUInt32LE(attestationBytes.length);
const instructionData = new Uint8Array(
  Buffer.concat([discriminator, messageLenBuffer, messageBytes, attestationLenBuffer, attestationBytes]),
);

const receiveMessageIx = {
  programAddress: MESSAGE_TRANSMITTER_PROGRAM,
  accounts: [
    { address: solanaKeypair.address, role: 3, signer: solanaKeypair },
    { address: solanaKeypair.address, role: 0 },
    { address: authorityPda, role: 0 },
    { address: messageTransmitter, role: 0 },
    { address: usedNonces, role: 1 },
    { address: TOKEN_MESSENGER_MINTER_PROGRAM, role: 0 },
    { address: SYSTEM_PROGRAM_ADDRESS, role: 0 },
    { address: eventAuthority, role: 0 },
    { address: MESSAGE_TRANSMITTER_PROGRAM, role: 0 },
    { address: tokenMessenger, role: 0 },
    { address: remoteTokenMessenger, role: 0 },
    { address: tokenMinter, role: 1 },
    { address: localToken, role: 1 },
    { address: tokenPair, role: 0 },
    { address: feeRecipientTokenAccount, role: 1 },
    { address: mintRecipient, role: 1 },
    { address: custody, role: 1 },
    { address: TOKEN_PROGRAM_ADDRESS, role: 0 },
    { address: tokenProgramEventAuthority, role: 0 },
    { address: TOKEN_MESSENGER_MINTER_PROGRAM, role: 0 },
  ],
  data: instructionData,
};

console.log(JSON.stringify({
  sourceTx: SOURCE_TX,
  payer: solanaKeypair.address,
  mintRecipient,
  feeRecipientTokenAccount,
  messageTransmitter,
  tokenMessenger,
}, null, 2));

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
const transactionMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayerSigner(solanaKeypair, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstruction(receiveMessageIx, tx),
);
const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
console.log(`Solana receiveMessage tx: ${getSignatureFromTransaction(signedTransaction)}`);

async function fetchAttestation(sourceDomain, tx) {
  const url = `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${tx}`;
  const response = await fetch(url);
  const data = await response.json();
  const message = data.messages?.[0];
  if (!message) throw new Error(`No Circle message found: ${JSON.stringify(data)}`);
  return message;
}

async function loadEnv() {
  const { readFileSync, existsSync } = await import("node:fs");
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...parts] = trimmed.split("=");
    process.env[key] ??= parts.join("=");
  }
}

function bs58Encode(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    const mod = value % 58n;
    encoded = alphabet[Number(mod)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = alphabet[0] + encoded;
  }
  return encoded || alphabet[0];
}
