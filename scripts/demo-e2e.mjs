import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const env = loadEnv();
const redeemShares = getArg("--shares") ?? "0.5";
const sourceTx = getArg("--tx") ?? env.CCTP_SOURCE_TX;

if (!sourceTx) {
  throw new Error("Set CCTP_SOURCE_TX in .env or pass --tx <base deposit tx>");
}

console.log("== OmniETF CLI E2E Demo ==");
console.log(`Base deposit tx: ${sourceTx}`);

run("Circle attestation status", ["node", "scripts/cctp-status.mjs", sourceTx]);
run("Mock xStock allocation", ["node", "scripts/portfolio.mjs", "allocate"]);
run("Devnet mock xStock SPL mint settlement", ["node", "scripts/xstock-devnet.mjs", "allocate"]);
run("Devnet mock xStock balances", ["node", "scripts/xstock-devnet.mjs", "balances"]);
run("NAV", ["node", "scripts/portfolio.mjs", "nav"]);
run("Redeem quote", ["node", "scripts/portfolio.mjs", "redeem", "--shares", redeemShares]);

console.log("\nDemo complete.");

function run(label, command) {
  console.log(`\n## ${label}`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

function loadEnv() {
  if (!existsSync(".env")) return process.env;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...parts] = trimmed.split("=");
    process.env[key] ??= parts.join("=");
  }
  return process.env;
}
