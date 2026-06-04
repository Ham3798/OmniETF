import "dotenv/config";
import { readFileSync } from "node:fs";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther } from "ethers";
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

function evmAddressBytes(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid address: ${address}`);
  return Buffer.from(address.slice(2), "hex");
}

function bytes32(pubkey) {
  return `0x${new PublicKey(pubkey).toBuffer().toString("hex")}`;
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

function artifact() {
  return JSON.parse(
    readFileSync("out/OmniETFCCIPSender.sol/OmniETFCCIPSender.json", "utf8"),
  );
}

function request(senderContract) {
  const state = deriveState();
  const approvedSender = deriveApprovedSender(BASE_SEPOLIA_SELECTOR, evmAddressBytes(senderContract));
  return {
    destinationChainSelector: SOLANA_DEVNET_SELECTOR,
    receiver: bytes32(PROGRAM_ID),
    tokenReceiver: bytes32(PROGRAM_ID),
    accounts: [bytes32(approvedSender), bytes32(state)],
    accountIsWritableBitmap: 2n,
    computeUnits: BigInt(process.env.CCIP_SOLANA_COMPUTE_UNITS ?? 200_000),
    aaplUnits: BigInt(process.env.CCIP_AAPL_UNITS ?? 4),
    tslaUnits: BigInt(process.env.CCIP_TSLA_UNITS ?? 3),
    nvdaUnits: BigInt(process.env.CCIP_NVDA_UNITS ?? 3),
  };
}

async function main() {
  const command = process.argv[2] ?? "quote";
  const provider = new JsonRpcProvider(env("BASE_SEPOLIA_RPC_URL"));
  const wallet = new Wallet(env("PRIVATE_KEY"), provider);
  const { abi, bytecode } = artifact();

  if (command === "deploy") {
    const factory = new ContractFactory(abi, bytecode.object ?? bytecode, wallet);
    const contract = await factory.deploy(BASE_SEPOLIA_ROUTER);
    const deployment = await contract.deploymentTransaction().wait(1);
    console.log(`senderContract=${await contract.getAddress()}`);
    console.log(`deployTx=${deployment.hash}`);
    console.log(`baseScan=https://sepolia.basescan.org/tx/${deployment.hash}`);
    return;
  }

  const address = process.argv[3] ?? process.env.CCIP_BASE_SENDER_CONTRACT;
  if (!address) throw new Error("sender contract address is required");

  const contract = new Contract(address, abi, wallet);
  const req = request(address);
  const fee = await contract.quoteAllocate(req);

  if (command === "quote") {
    console.log(`senderContract=${address}`);
    console.log(`owner=${await contract.owner()}`);
    console.log(`state=${deriveState().toBase58()}`);
    console.log(
      `approvedSender=${deriveApprovedSender(BASE_SEPOLIA_SELECTOR, evmAddressBytes(address)).toBase58()}`,
    );
    console.log(`feeWei=${fee}`);
    console.log(`feeEth=${formatEther(fee)}`);
    return;
  }

  if (command === "send") {
    const tx = await contract.sendAllocate(req, { value: fee });
    console.log(`sendTx=${tx.hash}`);
    console.log(`baseScan=https://sepolia.basescan.org/tx/${tx.hash}`);
    const receipt = await tx.wait(1);
    const parsed = receipt.logs
      .map((log) => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return undefined;
        }
      })
      .find((event) => event?.name === "AllocateSent");
    if (parsed) {
      console.log(`messageId=${parsed.args.messageId}`);
      console.log(`ccipMessage=https://ccip.chain.link/msg/${parsed.args.messageId}`);
      console.log(`ccipTx=https://ccip.chain.link/tx/${tx.hash}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
