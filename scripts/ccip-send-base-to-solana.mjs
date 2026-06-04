import "dotenv/config";
import { EVMChain, getCCIPExplorerLinks } from "@chainlink/ccip-sdk";
import { Wallet } from "ethers";
import { PublicKey } from "@solana/web3.js";

const BASE_SEPOLIA_ROUTER =
  process.env.CCIP_BASE_SEPOLIA_ROUTER ?? "0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93";
const SOLANA_DEVNET_SELECTOR = BigInt(
  process.env.CCIP_SOLANA_DEVNET_SELECTOR ?? "16423721717087811551",
);
const BASE_SEPOLIA_SELECTOR = BigInt(
  process.env.BASE_SEPOLIA_CHAIN_SELECTOR ?? "10344971235874465080",
);
const PROGRAM_ID = new PublicKey(
  process.env.SOLANA_CUSTODY_PROGRAM_ID ?? "4LaatT5FGgWMkFfT3zLUSEnsaWegk52a2nEwk8VRR881",
);
const STATE_SEED = Buffer.from("state");
const APPROVED_SENDER_SEED = Buffer.from("approved_ccip_sender");

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/^"|"$/g, "");
}

function u64le(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function allocatePayload(aapl = 4n, tsla = 3n, nvda = 3n) {
  return `0x${Buffer.concat([Buffer.from([1]), u64le(aapl), u64le(tsla), u64le(nvda)]).toString(
    "hex",
  )}`;
}

function evmAddressBytes(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }
  return Buffer.from(address.slice(2), "hex");
}

function deriveState() {
  return PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID)[0];
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

async function main() {
  const source = await EVMChain.fromUrl(env("BASE_SEPOLIA_RPC_URL"));
  const wallet = new Wallet(env("PRIVATE_KEY"), source.provider);
  const sender = await wallet.getAddress();
  const state = deriveState();
  const approvedSender = deriveApprovedSender(BASE_SEPOLIA_SELECTOR, evmAddressBytes(sender));

  const message = {
    receiver: PROGRAM_ID.toBase58(),
    data: allocatePayload(
      process.env.CCIP_AAPL_UNITS ?? 4,
      process.env.CCIP_TSLA_UNITS ?? 3,
      process.env.CCIP_NVDA_UNITS ?? 3,
    ),
    extraArgs: {
      computeUnits: BigInt(process.env.CCIP_SOLANA_COMPUTE_UNITS ?? 200_000),
      accountIsWritableBitmap: 2n,
      allowOutOfOrderExecution: true,
      tokenReceiver: PROGRAM_ID.toBase58(),
      accounts: [approvedSender.toBase58(), state.toBase58()],
    },
  };

  const fee = await source.getFee({
    router: BASE_SEPOLIA_ROUTER,
    destChainSelector: SOLANA_DEVNET_SELECTOR,
    message,
  });

  if ((process.argv[2] ?? "quote") === "quote") {
    console.log(`sender=${sender}`);
    console.log(`router=${BASE_SEPOLIA_ROUTER}`);
    console.log(`receiverProgram=${PROGRAM_ID.toBase58()}`);
    console.log(`state=${state.toBase58()}`);
    console.log(`approvedSender=${approvedSender.toBase58()}`);
    console.log(`feeWei=${fee}`);
    return;
  }

  const request = await source.sendMessage({
    router: BASE_SEPOLIA_ROUTER,
    destChainSelector: SOLANA_DEVNET_SELECTOR,
    message: { ...message, fee },
    wallet,
  });
  const links = getCCIPExplorerLinks(request);

  console.log(`sender=${sender}`);
  console.log(`sourceTx=${request.tx.hash}`);
  console.log(`messageId=${request.message.messageId}`);
  console.log(`ccipMessage=${links.message}`);
  console.log(`ccipTx=${links.transaction}`);
  console.log(`ccipReceiver=${links.receiver}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
