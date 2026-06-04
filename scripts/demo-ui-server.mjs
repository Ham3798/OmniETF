import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeNav, quoteRedeem } from "./portfolio-core.mjs";

await loadEnv();

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(rootDir, "demo-ui");
const port = Number(process.env.DEMO_UI_PORT ?? getArg("--port") ?? 4173);

const commands = {
  "portfolio:allocate": ["npm", ["run", "portfolio:allocate"]],
  "portfolio:nav": ["npm", ["run", "portfolio:nav"]],
  "portfolio:redeem": ["npm", ["run", "portfolio:redeem", "--", "--shares", "0.5"]],
  "portfolio:execute-redeem": ["npm", ["run", "portfolio:execute-redeem", "--", "--shares", "0.5"]],
  "vault:demo": ["npm", ["run", "vault:demo"]],
  "demo:e2e": ["npm", ["run", "demo:e2e"]],
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname === "/api/state") return sendJson(response, buildState());
    if (url.pathname === "/api/live/settle-deposit" && request.method === "POST") {
      const body = await readBody(request);
      return runLiveRelayer(response, "settle-deposit", body.txHash);
    }
    if (url.pathname === "/api/live/fulfill-redeem" && request.method === "POST") {
      const body = await readBody(request);
      return runLiveRelayer(response, "fulfill-redeem", body.txHash);
    }
    if (url.pathname === "/api/run" && request.method === "POST") {
      const body = await readBody(request);
      return runCommand(response, body.command);
    }
    if (url.pathname === "/api/commands") return sendJson(response, Object.keys(commands));
    return serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, { error: error.message }, 500);
  }
});

server.listen(port, () => {
  console.log(`OmniETF demo UI: http://localhost:${port}`);
});

function buildState() {
  const ledgerPath = process.env.PORTFOLIO_LEDGER_PATH ?? ".omnietf/portfolio-ledger.json";
  const settlementPath = process.env.REDEEM_SETTLEMENT_PATH ?? ".omnietf/redeem-settlement.json";
  const xstockPath = ".omnietf/xstock-devnet.json";

  const includeLocalLedger = process.env.DEMO_INCLUDE_LOCAL_LEDGER === "1";
  const ledger = includeLocalLedger ? readJsonIfExists(ledgerPath) : null;
  const settlement = includeLocalLedger ? readJsonIfExists(settlementPath) : null;
  const xstock = includeLocalLedger ? readJsonIfExists(xstockPath) : null;
  const nav = ledger ? summarizeNav(ledger) : null;
  const redeemQuote = ledger ? quoteRedeem(ledger, "0.5") : null;

  return {
    generatedAt: new Date().toISOString(),
    env: safeEnvSummary(),
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
      address: process.env.OMNIETF_OZ_ASYNC_VAULT ?? "0x77cAea5FDF52fD0C59577ED4739D9A49588Ff25e",
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
    commands: Object.keys(commands),
    staticMode: false,
  };
}

function ccipMessages() {
  return [];
}

function lifecycle() {
  return [
    lifecycleItem("deposit-request", "01", "Buy request", "Base", "ERC-7540 request", "0.005 USDC", "requestDeposit", "User starts the async deposit on the Base vault. No mETF is minted yet.", "Base Sepolia", "0x93e2c96c1b8db7adcc300d446ddb09d3680c7c905a62ad248e3e4c227c78787e"),
    lifecycleItem("cctp-receive", "02", "CCTP mint", "CCTP", "Burn / mint", "0.00495 USDC", "receiveMessage", "Circle CCTP mints Solana devnet USDC into the configured token account.", "Solana Devnet", "HyUSQGFrZa7BkxvJnXLFYKk9HkcyzFdC1AuJKUWedgQDSwVjF52iEeyCwDcJx29jKGQWJMVzHJfq9wNY2Pxyajn"),
    lifecycleItem("reporter-settle", "03", "Reporter settle", "Base", "markDepositSettled", "request 4", "settled", "Reporter records that the CCTP settlement leg reached Solana.", "Base Sepolia", "0x29eae4215382f0126a40edd1db3d11d49722e9d393e632816dff3d570694669e"),
    lifecycleItem("reporter-execute", "04", "Reporter execute", "Base", "executedValue / NAV", "0.00495 mETF", "claimable", "Reporter finalizes the executed value and makes shares claimable.", "Base Sepolia", "0xa4163a447e2cc0dbd1282db9edd0863420320d8f166e1a7540c240ad5cb163c9"),
    lifecycleItem("claim", "05", "Claim", "Base", "ERC-7540 claim", "0.00495 mETF", "deposit", "User claims mETF only after reporter finalization.", "Base Sepolia", "0x7b12b58981e383fd0864675e4932480288791c6de0b46e39d60c0a642993c8ff"),
    lifecycleItem("redeem-request", "06", "Redeem request", "Base", "share escrow", "0.114936 mETF", "requestRedeem", "User escrows shares for async redeem.", "Base Sepolia", "0xf6aba35e2694928d124b8e29ca56bdb5aa428913f60a959cddcd8778018bac82"),
    lifecycleItem("redeem-fund", "07", "Redeem funded", "Base", "reporter payout", "0.114936 USDC", "fundRedeemPayout", "Reporter funds the vault with claimable USDC.", "Base Sepolia", "0x8227ab867885059d4953324e02d27dd26c25e58534f7154770011ba4eedfea39"),
    lifecycleItem("redeem-claim", "08", "Redeem claim", "Base", "ERC-7540 claim", "0.114936 USDC", "redeem", "User burns escrowed mETF and receives Base USDC.", "Base Sepolia", "0xb617253a29196cd81f7d09c4f296cf1e7e10608c6d1f2727b7cf3240837ba9c8"),
  ];
}

function lifecycleItem(id, step, label, lane, rail, value, artifact, description, chain, tx) {
  const isSolana = !tx.startsWith("0x");
  return {
    id,
    step,
    label,
    lane,
    rail,
    value,
    artifact,
    description,
    status: "verified",
    chain,
    tx,
    url: isSolana
      ? `https://explorer.solana.com/tx/${tx}?cluster=devnet`
      : `https://sepolia.basescan.org/tx/${tx}`,
  };
}

function buildCodeSnippets() {
  return [
    {
      id: "request-deposit",
      title: "Base requestDeposit",
      file: "contracts/OmniETFOZAsyncVault.sol",
      description: "Deposit is recorded as an async request. No mETF is minted before settlement and execution are finalized.",
      lines: "178-187",
      code: readSnippet("contracts/OmniETFOZAsyncVault.sol", 178, 187),
    },
    {
      id: "finalize-deposit",
      title: "Reporter finalizeDeposit",
      file: "contracts/OmniETFOZAsyncVault.sol",
      description: "The reporter turns Solana executed value into claimable Base shares using the current NAV conversion.",
      lines: "278-304",
      code: readSnippet("contracts/OmniETFOZAsyncVault.sol", 278, 304),
    },
    {
      id: "claim-redeem",
      title: "Base claimRedeem",
      file: "contracts/OmniETFOZAsyncVault.sol",
      description: "Redeem claims are paid only after shares are escrowed and backing USDC is marked claimable.",
      lines: "322-333",
      code: readSnippet("contracts/OmniETFOZAsyncVault.sol", 322, 333),
    },
    {
      id: "ccip-send",
      title: "CCIP sendAllocate",
      file: "contracts/OmniETFCCIPSender.sol",
      description: "CCIP is represented as a control/test-token rail. The message carries allocation intent separately from CCTP USDC settlement.",
      lines: "63-80",
      code: readSnippet("contracts/OmniETFCCIPSender.sol", 63, 80),
    },
  ];
}

function readSnippet(path, startLine, endLine) {
  const absolute = join(rootDir, path);
  if (!existsSync(absolute)) return `// Missing ${path}`;
  return readFileSync(absolute, "utf8")
    .split("\n")
    .slice(startLine - 1, endLine)
    .join("\n");
}

function runCommand(response, command) {
  const commandSpec = commands[command];
  if (!commandSpec) return sendJson(response, { error: `Unknown command: ${command}` }, 400);

  const [program, args] = commandSpec;
  const child = spawn(program, args, { cwd: rootDir, env: process.env });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.on("close", (code) => {
    sendJson(response, {
      command,
      exitCode: code,
      ok: code === 0,
      output: output.slice(-30_000),
      state: buildState(),
    });
  });
}

function runLiveRelayer(response, command, txHash) {
  if (!txHash || typeof txHash !== "string") {
    return sendJson(response, { error: "Missing txHash" }, 400);
  }

  const child = spawn("node", ["scripts/omnietf-live-relayer.mjs", command, "--tx", txHash], {
    cwd: rootDir,
    env: process.env,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.on("close", (code) => {
    let parsed = null;
    try {
      parsed = JSON.parse(output.slice(output.indexOf("{")));
    } catch {
      // Keep raw output below.
    }
    sendJson(
      response,
      {
        ok: code === 0,
        command,
        exitCode: code,
        result: parsed,
        output: output.slice(-30_000),
        state: buildState(),
        error: code === 0 ? undefined : output.slice(-2_000) || `${command} failed`,
      },
      code === 0 ? 200 : 500,
    );
  });
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const absolute = normalize(join(publicDir, requested));
  if (!absolute.startsWith(publicDir) || !existsSync(absolute)) {
    sendJson(response, { error: "Not found" }, 404);
    return;
  }

  response.writeHead(200, { "content-type": contentType(absolute) });
  createReadStream(absolute).pipe(response);
}

function contentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  }[extname(path)] ?? "application/octet-stream";
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function sendJson(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function safeEnvSummary() {
  return {
    baseRpcConfigured: Boolean(process.env.BASE_SEPOLIA_RPC_URL),
    solanaRpc: process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
    cctpSourceTxConfigured: Boolean(process.env.CCTP_SOURCE_TX),
    solanaUsdcTokenAccountConfigured: Boolean(process.env.SOLANA_USDC_TOKEN_ACCOUNT),
    privateKeyConfigured: Boolean(process.env.PRIVATE_KEY),
  };
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

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}
