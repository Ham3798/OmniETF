import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { ethers } from "ethers";

await loadEnv();

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

const BASE_RPC = mustEnv("BASE_SEPOLIA_RPC_URL");
const PRIVATE_KEY = mustEnv("PRIVATE_KEY");
const VAULT = args.vault ?? process.env.OMNIETF_OZ_ASYNC_VAULT ?? "0x77cAea5FDF52fD0C59577ED4739D9A49588Ff25e";
const USDC = process.env.BASE_SEPOLIA_USDC ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SOLANA_USDC_TOKEN_ACCOUNT =
  process.env.SOLANA_USDC_TOKEN_ACCOUNT ?? "9y7ns4FyHSFscz5yvgAfchDVzr9VUsyDSx56VttABut";
const SOLANA_RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";

const provider = new ethers.JsonRpcProvider(BASE_RPC);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);
const vault = new ethers.Contract(
  VAULT,
  [
    "event DepositRequest(address indexed controller,address indexed owner,uint256 indexed requestId,address sender,uint256 assets)",
    "event RedeemRequest(address indexed controller,address indexed owner,uint256 indexed requestId,address sender,uint256 shares)",
    "function depositIdByRequestId(uint256) view returns (bytes32)",
    "function redeemIdByRequestId(uint256) view returns (bytes32)",
    "function deposits(bytes32) view returns (address controller,address owner,uint256 requestedAssets,uint256 claimableAssets,uint256 claimableShares,uint256 claimableManagedAssets,uint256 claimedAssets,uint256 claimedShares,uint256 claimedManagedAssets,bytes32 solanaUsdcTokenAccount,uint256 maxFee,uint256 requestId,uint8 state)",
    "function redeems(bytes32) view returns (address controller,address owner,uint256 requestedShares,uint256 claimableShares,uint256 claimableAssets,uint256 claimedShares,uint256 claimedAssets,uint256 requestId,uint8 state)",
    "function markDepositSettled(bytes32)",
    "function markDepositExecuted(bytes32,uint256)",
    "function fundRedeemPayout(bytes32,uint256)",
    "function maxDeposit(address) view returns (uint256)",
    "function maxRedeem(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function totalManagedAssets() view returns (uint256)",
  ],
  signer,
);
const usdc = new ethers.Contract(
  USDC,
  [
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
  ],
  signer,
);

if (command === "settle-deposit") {
  const txHash = args.tx ?? args._[1];
  if (!txHash) throw new Error("Usage: node scripts/omnietf-live-relayer.mjs settle-deposit --tx <base-tx>");
  const result = await settleDeposit(txHash);
  console.log(JSON.stringify(result, null, 2));
} else if (command === "fulfill-redeem") {
  const txHash = args.tx ?? args._[1];
  if (!txHash) throw new Error("Usage: node scripts/omnietf-live-relayer.mjs fulfill-redeem --tx <base-tx>");
  const result = await fulfillRedeem(txHash);
  console.log(JSON.stringify(result, null, 2));
} else if (command === "state") {
  const account = args.account ?? signer.address;
  console.log(JSON.stringify(await readState(account), null, 2));
} else {
  throw new Error("Usage: settle-deposit | fulfill-redeem | state");
}

async function settleDeposit(txHash) {
  const receipt = await waitForReceipt(txHash);
  const { requestId, controller, assets } = parseDepositRequest(receipt);
  const depositId = await vault.depositIdByRequestId(requestId);
  const existing = await vault.deposits(depositId);
  if (Number(existing.state) >= 3) {
    return {
      ok: true,
      type: "deposit-already-claimable",
      txHash,
      requestId: requestId.toString(),
      depositId,
      controller,
      requestedAssets: assets.toString(),
      receivedUnits: existing.claimableAssets.toString(),
      solanaReceiveTx: null,
      circleStatus: "complete",
      maxDeposit: (await vault.maxDeposit(controller)).toString(),
      state: await readState(controller),
    };
  }
  const before = await getSolanaTokenBalance(SOLANA_USDC_TOKEN_ACCOUNT);
  const beforeSignature = await getLatestSolanaSignature(SOLANA_USDC_TOKEN_ACCOUNT);
  const attestation = await waitForCircleAttestation("6", txHash);

  let receiveSignature = null;
  let receiveOutput = "";
  try {
    const receive = spawnSync("node", ["scripts/receive-cctp-solana.mjs", txHash], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    });
    receiveOutput = `${receive.stdout ?? ""}${receive.stderr ?? ""}`;
    if (receive.status !== 0) throw new Error(receiveOutput || `receive script exited ${receive.status}`);
    receiveSignature = receiveOutput.match(/Solana receiveMessage tx:\s*([1-9A-HJ-NP-Za-km-z]+)/)?.[1] ?? null;
  } catch (error) {
    const current = await vault.deposits(depositId);
    if (Number(current.state) < 2) {
      throw new Error(`Solana receiveMessage failed before deposit execution: ${error.message}`);
    }
  }

  const after = await waitForSolanaBalanceAtLeast(SOLANA_USDC_TOKEN_ACCOUNT, before);
  let receivedUnits = after - before;
  if (receivedUnits <= 0n && receiveSignature) {
    receivedUnits = await getSolanaTokenDelta(receiveSignature, SOLANA_USDC_TOKEN_ACCOUNT);
  }
  if (receivedUnits <= 0n) {
    const latestSignature = await waitForNewSolanaSignature(
      SOLANA_USDC_TOKEN_ACCOUNT,
      beforeSignature,
    );
    if (latestSignature) {
      receiveSignature ??= latestSignature;
      receivedUnits = await getSolanaTokenDelta(latestSignature, SOLANA_USDC_TOKEN_ACCOUNT);
    }
  }
  if (receivedUnits <= 0n) {
    throw new Error(`Solana USDC balance did not increase. before=${before} after=${after}`);
  }

  const current = await vault.deposits(depositId);
  if (Number(current.state) === 1) {
    await (await vault.markDepositSettled(depositId)).wait();
    await waitForDepositState(depositId, 2);
  }
  const settled = await waitForDepositState(depositId, 2);
  if (Number(settled.state) === 2) {
    await (await vault.markDepositExecuted(depositId, receivedUnits)).wait();
    await waitForDepositState(depositId, 3);
  }

  return {
    ok: true,
    type: "deposit-settled",
    txHash,
    requestId: requestId.toString(),
    depositId,
    controller,
    requestedAssets: assets.toString(),
    receivedUnits: receivedUnits.toString(),
    solanaReceiveTx: receiveSignature,
    circleStatus: attestation.status,
    maxDeposit: (await waitForMaxDeposit(controller)).toString(),
    state: await readState(controller),
  };
}

async function fulfillRedeem(txHash) {
  const receipt = await waitForReceipt(txHash);
  const { requestId, controller, shares } = parseRedeemRequest(receipt);
  const redeemId = await vault.redeemIdByRequestId(requestId);
  const existing = await vault.redeems(redeemId);
  if (Number(existing.state) >= 3) {
    return {
      ok: true,
      type: "redeem-already-funded",
      txHash,
      requestId: requestId.toString(),
      redeemId,
      controller,
      requestedShares: shares.toString(),
      assetsClaimable: existing.claimableAssets.toString(),
      maxRedeem: (await vault.maxRedeem(controller)).toString(),
      state: await readState(controller),
    };
  }
  const assetsClaimable = shares;
  const balance = await usdc.balanceOf(signer.address);
  if (balance < assetsClaimable) {
    throw new Error(`Reporter USDC balance too low: need=${assetsClaimable} have=${balance}`);
  }
  const allowance = await usdc.allowance(signer.address, VAULT);
  if (allowance < assetsClaimable) {
    if (allowance > 0n) {
      await (await usdc.approve(VAULT, 0)).wait();
      await waitForEvmAllowance(0n);
    }
    await (await usdc.approve(VAULT, assetsClaimable)).wait();
    await waitForEvmAllowance(assetsClaimable);
  }
  await (await vault.fundRedeemPayout(redeemId, assetsClaimable)).wait();
  const maxRedeem = await waitForMaxRedeem(controller);
  return {
    ok: true,
    type: "redeem-funded",
    txHash,
    requestId: requestId.toString(),
    redeemId,
    controller,
    requestedShares: shares.toString(),
    assetsClaimable: assetsClaimable.toString(),
    maxRedeem: maxRedeem.toString(),
    state: await readState(controller),
  };
}

async function readState(account) {
  return {
    vault: VAULT,
    reporter: signer.address,
    account,
    totalSupply: (await vault.totalSupply()).toString(),
    totalManagedAssets: (await vault.totalManagedAssets()).toString(),
    maxDeposit: (await vault.maxDeposit(account)).toString(),
    maxRedeem: (await vault.maxRedeem(account)).toString(),
    vaultUsdcBalance: (await usdc.balanceOf(VAULT)).toString(),
    solanaUsdcTokenAccount: SOLANA_USDC_TOKEN_ACCOUNT,
    solanaUsdcBalance: (await getSolanaTokenBalance(SOLANA_USDC_TOKEN_ACCOUNT)).toString(),
  };
}

async function waitForReceipt(txHash) {
  const receipt = await provider.waitForTransaction(txHash, 1, 180_000);
  if (!receipt) throw new Error(`Base tx not mined yet: ${txHash}`);
  if (receipt.status !== 1) throw new Error(`Base tx reverted: ${txHash}`);
  return receipt;
}

async function waitForEvmAllowance(minimum) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const allowance = await usdc.allowance(signer.address, VAULT);
    if (minimum === 0n ? allowance === 0n : allowance >= minimum) return allowance;
    await delay(1_000);
  }
  throw new Error(`USDC allowance did not reach ${minimum}`);
}

async function waitForMaxDeposit(controller) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const value = await vault.maxDeposit(controller);
    if (value > 0n) return value;
    await delay(1_000);
  }
  return await vault.maxDeposit(controller);
}

async function waitForMaxRedeem(controller) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const value = await vault.maxRedeem(controller);
    if (value > 0n) return value;
    await delay(1_000);
  }
  return await vault.maxRedeem(controller);
}

async function waitForDepositState(depositId, expectedState) {
  let current = await vault.deposits(depositId);
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    current = await vault.deposits(depositId);
    if (Number(current.state) === expectedState) return current;
    await delay(1_000);
  }
  return current;
}

function parseDepositRequest(receipt) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== VAULT.toLowerCase()) continue;
    try {
      const parsed = vault.interface.parseLog(log);
      if (parsed?.name === "DepositRequest") {
        return {
          controller: parsed.args.controller,
          owner: parsed.args.owner,
          requestId: parsed.args.requestId,
          assets: parsed.args.assets,
        };
      }
    } catch {
      // Ignore non-vault events not in the minimal ABI.
    }
  }
  throw new Error(`DepositRequest event not found in ${receipt.hash}`);
}

function parseRedeemRequest(receipt) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== VAULT.toLowerCase()) continue;
    try {
      const parsed = vault.interface.parseLog(log);
      if (parsed?.name === "RedeemRequest") {
        return {
          controller: parsed.args.controller,
          owner: parsed.args.owner,
          requestId: parsed.args.requestId,
          shares: parsed.args.shares,
        };
      }
    } catch {
      // Ignore non-vault events not in the minimal ABI.
    }
  }
  throw new Error(`RedeemRequest event not found in ${receipt.hash}`);
}

async function waitForCircleAttestation(sourceDomain, txHash) {
  let last = null;
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    const url = `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${txHash}`;
    const response = await fetch(url);
    const data = await response.json();
    last = data.messages?.[0] ?? data;
    if (last?.status === "complete") return last;
    await delay(8_000);
  }
  throw new Error(`Circle attestation not complete: ${JSON.stringify(last)}`);
}

async function getSolanaTokenBalance(account) {
  const result = await solanaRpc("getTokenAccountBalance", [account]);
  return BigInt(result.value.amount);
}

async function waitForSolanaBalanceAtLeast(account, previousBalance) {
  let current = previousBalance;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    current = await getSolanaTokenBalance(account);
    if (current > previousBalance) return current;
    await delay(1_000);
  }
  return current;
}

async function getLatestSolanaSignature(account) {
  const signatures = await solanaRpc("getSignaturesForAddress", [account, { limit: 1 }]);
  return signatures?.[0]?.signature ?? null;
}

async function waitForNewSolanaSignature(account, previousSignature) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const signature = await getLatestSolanaSignature(account);
    if (signature && signature !== previousSignature) return signature;
    await delay(1_000);
  }
  return null;
}

async function getSolanaTokenDelta(signature, tokenAccount) {
  const tx = await solanaRpc("getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);
  const keys = tx?.transaction?.message?.accountKeys ?? [];
  const accountIndex = keys.findIndex((key) => {
    const pubkey = typeof key === "string" ? key : key.pubkey;
    return pubkey === tokenAccount;
  });
  if (accountIndex === -1) return 0n;
  const pre = tx.meta?.preTokenBalances?.find((item) => item.accountIndex === accountIndex);
  const post = tx.meta?.postTokenBalances?.find((item) => item.accountIndex === accountIndex);
  if (!pre || !post) return 0n;
  return BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount);
}

async function solanaRpc(method, params) {
  const response = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  return data.result;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function mustEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
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
