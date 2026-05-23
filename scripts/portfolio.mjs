import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createLedger, quoteRedeem, summarizeNav } from "./portfolio-core.mjs";

await loadEnv();

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));
const ledgerPath = args.out ?? args.ledger ?? process.env.PORTFOLIO_LEDGER_PATH ?? ".omnietf/portfolio-ledger.json";

if (command === "allocate") {
  const tokenAccount = args["token-account"] ?? process.env.SOLANA_USDC_TOKEN_ACCOUNT ?? tokenAccountFromMintRecipient();
  const usdcBaseUnits = args["usdc-base-units"] ?? await fetchTokenBalanceBaseUnits(tokenAccount);
  const ledger = createLedger({
    usdcBaseUnits,
    tokenAccount,
    sourceTx: process.env.CCTP_SOURCE_TX,
    receiveTx: process.env.CCTP_RECEIVE_TX,
  });

  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  printJson({ ledgerPath, ...summarizeNav(ledger) });
} else if (command === "nav") {
  const ledger = readLedger(ledgerPath);
  printJson({ ledgerPath, ...summarizeNav(ledger) });
} else if (command === "redeem") {
  const shares = args.shares;
  if (!shares) throw new Error("Pass --shares <amount>");
  const ledger = readLedger(ledgerPath);
  printJson({ ledgerPath, ...quoteRedeem(ledger, shares) });
} else {
  throw new Error("Usage: node scripts/portfolio.mjs <allocate|nav|redeem> [--shares n]");
}

function readLedger(path) {
  if (!existsSync(path)) throw new Error(`Ledger not found: ${path}. Run npm run portfolio:allocate first.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

async function fetchTokenBalanceBaseUnits(tokenAccount) {
  if (!tokenAccount) {
    throw new Error("Set SOLANA_USDC_TOKEN_ACCOUNT, MINT_RECIPIENT_BYTES32, or pass --token-account");
  }

  const rpcUrl = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountBalance",
      params: [tokenAccount],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(`getTokenAccountBalance failed: ${JSON.stringify(data.error)}`);
  return data.result.value.amount;
}

function tokenAccountFromMintRecipient() {
  const bytes32 = process.env.MINT_RECIPIENT_BYTES32;
  if (!bytes32 || !bytes32.startsWith("0x") || bytes32.length !== 66) return null;
  return bs58Encode(Buffer.from(bytes32.slice(2), "hex"));
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

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
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
