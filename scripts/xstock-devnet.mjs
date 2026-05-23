import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

await loadEnv();

const command = process.argv[2];
const ledgerPath = process.env.PORTFOLIO_LEDGER_PATH ?? ".omnietf/portfolio-ledger.json";
const statePath = process.env.XSTOCK_DEVNET_STATE_PATH ?? ".omnietf/xstock-devnet.json";
const keyDir = process.env.XSTOCK_DEVNET_KEY_DIR ?? ".keys/xstock-devnet";
const rpcUrl = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const authorityKeypair = process.env.SOLANA_KEYPAIR_PATH;

if (!authorityKeypair) {
  throw new Error("Set SOLANA_KEYPAIR_PATH. Devnet mock xStock mint authority needs a funded keypair.");
}

const authority = runText(["solana-keygen", "pubkey", authorityKeypair]);

if (command === "setup") {
  const state = setup();
  printJson(state);
} else if (command === "allocate") {
  const state = setup();
  const ledger = readJson(ledgerPath);
  const result = mintToPortfolioTreasury(state, ledger);
  writeJson(statePath, result.state);
  printJson(result.summary);
} else if (command === "balances") {
  const state = readJson(statePath);
  printJson(readBalances(state));
} else {
  throw new Error("Usage: node scripts/xstock-devnet.mjs <setup|allocate|balances>");
}

function setup() {
  mkdirSync(keyDir, { recursive: true });
  let state = existsSync(statePath)
    ? readJson(statePath)
    : {
        version: 1,
        network: "solana-devnet",
        authority,
        assets: {},
      };

  const ledger = existsSync(ledgerPath) ? readJson(ledgerPath) : null;
  const symbols = ledger?.portfolio?.assets?.map((asset) => asset.symbol) ?? ["AAPLx", "TSLAx", "NVDAx"];

  for (const symbol of symbols) {
    const mintKeypair = `${keyDir}/${symbol}-mint.json`;
    if (!existsSync(mintKeypair)) {
      run(["solana-keygen", "new", "--no-bip39-passphrase", "--silent", "--outfile", mintKeypair]);
    }

    const mint = runText(["solana-keygen", "pubkey", mintKeypair]);
    if (!accountExists(mint)) {
      run([
        "spl-token",
        "create-token",
        "--decimals",
        "9",
        "--mint-authority",
        authority,
        "--fee-payer",
        authorityKeypair,
        "--url",
        rpcUrl,
        mintKeypair,
      ]);
    }

    let tokenAccount = state.assets[symbol]?.tokenAccount;
    if (!tokenAccount || !accountExists(tokenAccount)) {
      const output = runText([
        "spl-token",
        "create-account",
        mint,
        "--owner",
        authority,
        "--fee-payer",
        authorityKeypair,
        "--url",
        rpcUrl,
      ]);
      tokenAccount = output.match(/Creating account\s+([1-9A-HJ-NP-Za-km-z]+)/)?.[1] ?? tokenAccount;
      if (!tokenAccount) tokenAccount = findAssociatedTokenAccount(mint);
    }

    state.assets[symbol] = {
      symbol,
      mint,
      mintKeypair,
      treasuryOwner: authority,
      tokenAccount,
      decimals: 9,
    };
  }

  writeJson(statePath, state);
  return state;
}

function mintToPortfolioTreasury(state, ledger) {
  const minted = [];
  for (const asset of ledger.portfolio.assets) {
    const token = state.assets[asset.symbol];
    if (!token) throw new Error(`Missing mock xStock setup for ${asset.symbol}`);

    const targetUnits = parseUnits(asset.mockQuantity, token.decimals);
    const currentUnits = getTokenAccountUnits(token.tokenAccount);
    const deltaUnits = targetUnits > currentUnits ? targetUnits - currentUnits : 0n;
    const deltaUi = formatUnits(deltaUnits, token.decimals);

    if (deltaUnits > 0n) {
      run([
        "spl-token",
        "mint",
        token.mint,
        deltaUi,
        token.tokenAccount,
        "--mint-authority",
        authorityKeypair,
        "--fee-payer",
        authorityKeypair,
        "--url",
        rpcUrl,
      ]);
    }

    minted.push({
      symbol: asset.symbol,
      mint: token.mint,
      treasuryTokenAccount: token.tokenAccount,
      targetQuantity: asset.mockQuantity,
      previousQuantity: formatUnits(currentUnits, token.decimals),
      mintedQuantity: deltaUi,
      finalQuantity: formatUnits(getTokenAccountUnits(token.tokenAccount), token.decimals),
    });
  }

  state.lastAllocation = {
    ledgerPath,
    cctpSourceTx: ledger.source.cctpSourceTx,
    updatedAt: new Date().toISOString(),
    assets: minted,
  };

  return {
    state,
    summary: {
      statePath,
      treasuryOwner: authority,
      mode: "devnet-mock-xstock-spl-mints",
      assets: minted,
    },
  };
}

function readBalances(state) {
  return {
    statePath,
    treasuryOwner: state.authority,
    assets: Object.values(state.assets).map((asset) => ({
      symbol: asset.symbol,
      mint: asset.mint,
      treasuryTokenAccount: asset.tokenAccount,
      balance: formatUnits(getTokenAccountUnits(asset.tokenAccount), asset.decimals),
    })),
  };
}

function findAssociatedTokenAccount(mint) {
  const output = runText([
    "spl-token",
    "address",
    "--token",
    mint,
    "--owner",
    authority,
    "--url",
    rpcUrl,
  ]);
  return output.trim().split(/\s+/).at(-1);
}

function getTokenAccountUnits(tokenAccount) {
  const info = JSON.parse(
    runText(["spl-token", "account-info", "--address", tokenAccount, "--url", rpcUrl, "--output", "json"]),
  );
  return BigInt(info.tokenAmount.amount);
}

function accountExists(pubkey) {
  const result = spawnSync("solana", ["account", pubkey, "--url", rpcUrl], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return result.status === 0;
}

function run(args) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function runText(args) {
  const result = run(args);
  return result.stdout.trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function parseUnits(value, decimals) {
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid token amount: ${value}`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(`${whole}${`${fraction}${"0".repeat(decimals)}`.slice(0, decimals)}`);
}

function formatUnits(value, decimals) {
  const amount = BigInt(value);
  const unit = 10n ** BigInt(decimals);
  const whole = amount / unit;
  const fraction = String(amount % unit).padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
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
