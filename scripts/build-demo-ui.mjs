import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeNav, quoteRedeem } from "./portfolio-core.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDir = join(rootDir, "demo-ui");
const outputDir = join(rootDir, "demo-dist");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
for (const file of ["index.html", "styles.css", "main.js", "wallet.js"]) {
  copyFileSync(join(sourceDir, file), join(outputDir, file));
}
writeJson(join(outputDir, "state.json"), buildStaticState());

console.log(`Built static demo UI at ${outputDir}`);

function buildStaticState() {
  const ledgerPath = ".omnietf/portfolio-ledger.json";
  const settlementPath = ".omnietf/redeem-settlement.json";
  const xstockPath = ".omnietf/xstock-devnet.json";
  const ledger = null;
  const settlement = null;
  const xstock = null;
  const nav = ledger ? summarizeNav(ledger) : null;
  const redeemQuote = ledger ? quoteRedeem(ledger, "0.5") : null;

  return {
    generatedAt: new Date().toISOString(),
    staticMode: true,
    env: {
      baseRpcConfigured: false,
      solanaRpc: "https://api.devnet.solana.com",
      cctpSourceTxConfigured: true,
      solanaUsdcTokenAccountConfigured: false,
      privateKeyConfigured: false,
    },
    files: {
      ledgerPath,
      ledgerExists: Boolean(ledger),
      settlementPath,
      settlementExists: Boolean(settlement),
      xstockPath,
      xstockExists: Boolean(xstock),
    },
    lifecycle: lifecycle(),
    ccipMessages: ccipMessages(),
    codeSnippets: buildCodeSnippets(),
    vault: {
      address: "0x77cAea5FDF52fD0C59577ED4739D9A49588Ff25e",
      totalSupply: "0",
      userBalance: "0",
      totalManagedAssets: "0",
      nav: nav?.navUsd ?? "1",
    },
    ledger,
    nav,
    redeemQuote,
    settlement,
    xstock,
    commands: [
      "portfolio:allocate",
      "portfolio:nav",
      "portfolio:redeem",
      "vault:demo",
      "demo:e2e",
    ],
  };
}

function ccipMessages() {
  return [];
}

function lifecycle() {
  return [
    {
      id: "deposit-request",
      step: "01",
      label: "Buy request",
      lane: "Base",
      rail: "ERC-7540 request",
      value: "0.005 USDC",
      artifact: "requestDeposit",
      description: "User starts the async deposit on the Base vault. No mETF is minted yet.",
      status: "verified",
      chain: "Base Sepolia",
      tx: "0x93e2c96c1b8db7adcc300d446ddb09d3680c7c905a62ad248e3e4c227c78787e",
      url: "https://sepolia.basescan.org/tx/0x93e2c96c1b8db7adcc300d446ddb09d3680c7c905a62ad248e3e4c227c78787e",
    },
    {
      id: "cctp-receive",
      step: "02",
      label: "CCTP mint",
      lane: "CCTP",
      rail: "Burn / mint",
      value: "0.00495 USDC",
      artifact: "receiveMessage",
      description: "Circle CCTP mints Solana devnet USDC into the configured token account.",
      status: "verified",
      chain: "Solana Devnet",
      tx: "HyUSQGFrZa7BkxvJnXLFYKk9HkcyzFdC1AuJKUWedgQDSwVjF52iEeyCwDcJx29jKGQWJMVzHJfq9wNY2Pxyajn",
      url: "https://explorer.solana.com/tx/HyUSQGFrZa7BkxvJnXLFYKk9HkcyzFdC1AuJKUWedgQDSwVjF52iEeyCwDcJx29jKGQWJMVzHJfq9wNY2Pxyajn?cluster=devnet",
    },
    {
      id: "reporter-settle",
      step: "03",
      label: "Reporter settle",
      lane: "Base",
      rail: "markDepositSettled",
      value: "request 4",
      artifact: "settled",
      description: "Reporter records that the CCTP settlement leg reached Solana.",
      status: "verified",
      chain: "Base Sepolia",
      tx: "0x29eae4215382f0126a40edd1db3d11d49722e9d393e632816dff3d570694669e",
      url: "https://sepolia.basescan.org/tx/0x29eae4215382f0126a40edd1db3d11d49722e9d393e632816dff3d570694669e",
    },
    {
      id: "reporter-execute",
      step: "04",
      label: "Reporter execute",
      lane: "Base",
      rail: "executedValue / NAV",
      value: "0.00495 mETF",
      artifact: "claimable",
      description: "Reporter finalizes the executed value and makes shares claimable.",
      status: "verified",
      chain: "Base Sepolia",
      tx: "0xa4163a447e2cc0dbd1282db9edd0863420320d8f166e1a7540c240ad5cb163c9",
      url: "https://sepolia.basescan.org/tx/0xa4163a447e2cc0dbd1282db9edd0863420320d8f166e1a7540c240ad5cb163c9",
    },
    {
      id: "claim",
      step: "05",
      label: "Claim",
      lane: "Base",
      rail: "ERC-7540 claim",
      value: "0.00495 mETF",
      artifact: "deposit",
      description: "User claims mETF only after reporter finalization.",
      status: "verified",
      chain: "Base Sepolia",
      tx: "0x7b12b58981e383fd0864675e4932480288791c6de0b46e39d60c0a642993c8ff",
      url: "https://sepolia.basescan.org/tx/0x7b12b58981e383fd0864675e4932480288791c6de0b46e39d60c0a642993c8ff",
    },
    {
      id: "redeem-request",
      step: "06",
      label: "Redeem request",
      lane: "Base",
      rail: "share escrow",
      value: "0.114936 mETF",
      artifact: "requestRedeem",
      description: "User escrows shares for async redeem.",
      status: "verified",
      chain: "Base Sepolia",
      tx: "0xf6aba35e2694928d124b8e29ca56bdb5aa428913f60a959cddcd8778018bac82",
      url: "https://sepolia.basescan.org/tx/0xf6aba35e2694928d124b8e29ca56bdb5aa428913f60a959cddcd8778018bac82",
    },
    {
      id: "redeem-fund",
      step: "07",
      label: "Redeem funded",
      lane: "Base",
      rail: "reporter payout",
      value: "0.114936 USDC",
      artifact: "fundRedeemPayout",
      description: "Reporter funds the vault with claimable USDC.",
      status: "verified",
      chain: "Base Sepolia",
      tx: "0x8227ab867885059d4953324e02d27dd26c25e58534f7154770011ba4eedfea39",
      url: "https://sepolia.basescan.org/tx/0x8227ab867885059d4953324e02d27dd26c25e58534f7154770011ba4eedfea39",
    },
    {
      id: "redeem-claim",
      step: "08",
      label: "Redeem claim",
      lane: "Base",
      rail: "ERC-7540 claim",
      value: "0.114936 USDC",
      artifact: "redeem",
      description: "User burns escrowed mETF and receives Base USDC.",
      status: "verified",
      chain: "Base Sepolia",
      tx: "0xb617253a29196cd81f7d09c4f296cf1e7e10608c6d1f2727b7cf3240837ba9c8",
      url: "https://sepolia.basescan.org/tx/0xb617253a29196cd81f7d09c4f296cf1e7e10608c6d1f2727b7cf3240837ba9c8",
    },
  ];
}

function buildCodeSnippets() {
  return [
    snippet("request-deposit", "Base requestDeposit", "contracts/OmniETFOZAsyncVault.sol", 178, 187, "Deposit is recorded as an async request. No mETF is minted before settlement and execution are finalized."),
    snippet("finalize-deposit", "Reporter finalizeDeposit", "contracts/OmniETFOZAsyncVault.sol", 278, 304, "The reporter turns Solana executed value into claimable Base shares using the current NAV conversion."),
    snippet("claim-redeem", "Base claimRedeem", "contracts/OmniETFOZAsyncVault.sol", 322, 333, "Redeem claims are paid only after shares are escrowed and backing USDC is marked claimable."),
    snippet("ccip-send", "CCIP sendAllocate", "contracts/OmniETFCCIPSender.sol", 63, 80, "CCIP is represented as a control/test-token rail. The message carries allocation intent separately from CCTP USDC settlement."),
  ];
}

function snippet(id, title, file, start, end, description) {
  return {
    id,
    title,
    file,
    description,
    lines: `${start}-${end}`,
    code: readFileSync(join(rootDir, file), "utf8").split("\n").slice(start - 1, end).join("\n"),
  };
}

function readJsonIfExists(path) {
  const absolute = join(rootDir, path);
  if (!existsSync(absolute)) return null;
  return JSON.parse(readFileSync(absolute, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
