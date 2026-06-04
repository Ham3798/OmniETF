import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

await loadEnv();

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args["dry-run"] ?? process.env.CCTP_DRY_RUN);
const sourceDomain = args["source-domain"] ?? process.env.REVERSE_CCTP_SOURCE_DOMAIN ?? "5";
const sourceTx = args.tx ?? process.env.REVERSE_CCTP_SOURCE_TX ?? process.env.CCTP_SOURCE_TX;
const messageTransmitter =
  args["message-transmitter"] ??
  process.env.BASE_SEPOLIA_MESSAGE_TRANSMITTER_V2 ??
  process.env.EVM_MESSAGE_TRANSMITTER_V2;
const rpcUrl = args["rpc-url"] ?? process.env.BASE_SEPOLIA_RPC_URL;
const privateKey = args["private-key"] ?? process.env.PRIVATE_KEY;
const messageOverride = args.message ?? process.env.CCTP_MESSAGE;
const attestationOverride = args.attestation ?? process.env.CCTP_ATTESTATION;

if (!sourceTx) throw new Error("Set REVERSE_CCTP_SOURCE_TX or pass --tx <solana burn signature>");
if (!messageTransmitter) throw new Error("Set BASE_SEPOLIA_MESSAGE_TRANSMITTER_V2");
if (!rpcUrl) throw new Error("Set BASE_SEPOLIA_RPC_URL");
if (!privateKey) throw new Error("Set PRIVATE_KEY");

const attestation =
  messageOverride && attestationOverride
    ? { status: "complete", message: messageOverride, attestation: attestationOverride }
    : await fetchAttestation(sourceDomain, sourceTx);
if (attestation.status !== "complete") {
  throw new Error(`Attestation is not complete: ${attestation.status} ${attestation.delayReason ?? ""}`);
}

const command = [
  "cast",
  "send",
  messageTransmitter,
  "receiveMessage(bytes,bytes)",
  attestation.message,
  attestation.attestation,
  "--rpc-url",
  rpcUrl,
  "--private-key",
  privateKey,
];

console.log(
  JSON.stringify(
    {
      mode: "evm-cctp-v2-receive-message",
      sourceDomain,
      sourceTx,
      messageTransmitter,
      messageBytes: byteLength(attestation.message),
      attestationBytes: byteLength(attestation.attestation),
      dryRun,
      command: dryRun ? redactPrivateKey(command) : undefined,
    },
    null,
    2,
  ),
);

if (dryRun) {
  process.exit(0);
}

const result = spawnSync(command[0], command.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  stdio: "inherit",
});

if (result.status !== 0) {
  throw new Error(`cast receiveMessage failed with exit code ${result.status}`);
}

async function fetchAttestation(domain, tx) {
  const url = `https://iris-api-sandbox.circle.com/v2/messages/${domain}?transactionHash=${tx}`;
  const response = await fetch(url);
  const data = await response.json();
  const message = data.messages?.[0];
  if (!message) throw new Error(`No Circle message found: ${JSON.stringify(data)}`);
  return message;
}

function byteLength(hex) {
  return hex?.startsWith("0x") ? (hex.length - 2) / 2 : 0;
}

function redactPrivateKey(command) {
  return command.map((part, index) => (command[index - 1] === "--private-key" ? "<redacted>" : part));
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
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...parts] = trimmed.split("=");
    process.env[key] ??= parts.join("=");
  }
}
