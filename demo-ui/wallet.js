const BASE_SEPOLIA = {
  chainId: "0x14a34",
  chainName: "Base Sepolia",
  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia.basescan.org"],
};

export const ONCHAIN_CONFIG = {
  chain: BASE_SEPOLIA,
  vault: "0x77cAea5FDF52fD0C59577ED4739D9A49588Ff25e",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  decimals: 6,
};

const SELECTORS = {
  totalSupply: "0x18160ddd",
  totalManagedAssets: "0x05b2bfb0",
  totalAssets: "0x01e1d114",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  approve: "0x095ea7b3",
  requestDeposit: "0x89f289d6",
  deposit: "0x2e2d2984",
  requestRedeem: "0xaa2f892d",
  redeem: "0xba087652",
  claimRedeem: "0xbf1a866f",
  maxDeposit: "0x402d267d",
  maxRedeem: "0xd905777e",
  maxWithdraw: "0xce96cb77",
};

export async function connectEvmWallet() {
  if (!window.ethereum) {
    return {
      ok: false,
      status: "No injected wallet",
      account: null,
      chainId: null,
      chainName: "Install MetaMask or another EIP-1193 wallet",
    };
  }

  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const chainId = await window.ethereum.request({ method: "eth_chainId" });

  if (chainId !== BASE_SEPOLIA.chainId) {
    await switchToBaseSepolia();
  }

  const finalChainId = await window.ethereum.request({ method: "eth_chainId" });
  return {
    ok: true,
    status: finalChainId === BASE_SEPOLIA.chainId ? "Connected to Base Sepolia" : "Connected",
    account,
    chainId: finalChainId,
    chainName: finalChainId === BASE_SEPOLIA.chainId ? "Base Sepolia" : finalChainId,
  };
}

export async function readLiveVaultState(account) {
  if (!window.ethereum) throw new Error("No injected wallet");
  await ensureBaseSepolia();
  const normalized = normalizeAddress(account);
  const [
    usdcBalance,
    usdcAllowance,
    shareBalance,
    totalSupply,
    totalManagedAssets,
    totalAssets,
    maxDeposit,
    maxRedeem,
    maxWithdraw,
  ] = await Promise.all([
    callUint(ONCHAIN_CONFIG.usdc, SELECTORS.balanceOf + encodeAddress(normalized)),
    callUint(
      ONCHAIN_CONFIG.usdc,
      SELECTORS.allowance + encodeAddress(normalized) + encodeAddress(ONCHAIN_CONFIG.vault),
    ),
    callUint(ONCHAIN_CONFIG.vault, SELECTORS.balanceOf + encodeAddress(normalized)),
    callUint(ONCHAIN_CONFIG.vault, SELECTORS.totalSupply),
    callUint(ONCHAIN_CONFIG.vault, SELECTORS.totalManagedAssets),
    callUint(ONCHAIN_CONFIG.vault, SELECTORS.totalAssets),
    callUint(ONCHAIN_CONFIG.vault, SELECTORS.maxDeposit + encodeAddress(normalized)),
    callUint(ONCHAIN_CONFIG.vault, SELECTORS.maxRedeem + encodeAddress(normalized)),
    callUint(ONCHAIN_CONFIG.vault, SELECTORS.maxWithdraw + encodeAddress(normalized)),
  ]);

  return {
    account: normalized,
    vault: ONCHAIN_CONFIG.vault,
    usdc: ONCHAIN_CONFIG.usdc,
    usdcBalance,
    usdcAllowance,
    shareBalance,
    totalSupply,
    totalManagedAssets,
    totalAssets,
    maxDeposit,
    maxRedeem,
    maxWithdraw,
  };
}

export async function approveUsdc(amountUsdc) {
  const account = await requireAccount();
  const amount = parseUnits(amountUsdc);
  const data = SELECTORS.approve + encodeAddress(ONCHAIN_CONFIG.vault) + encodeUint(amount);
  return sendTransaction({ from: account, to: ONCHAIN_CONFIG.usdc, data });
}

export async function requestVaultDeposit(amountUsdc, solanaRecipientBytes32, maxFeeUsdc) {
  const account = await requireAccount();
  const amount = parseUnits(amountUsdc);
  const maxFee = parseUnits(maxFeeUsdc);
  const recipient = encodeBytes32(solanaRecipientBytes32);
  const data =
    SELECTORS.requestDeposit + encodeUint(amount) + recipient + encodeUint(maxFee);
  return sendTransaction({ from: account, to: ONCHAIN_CONFIG.vault, data });
}

export async function claimVaultDeposit(assetsUsdc) {
  const account = await requireAccount();
  const assets = parseUnits(assetsUsdc);
  const data =
    SELECTORS.deposit + encodeUint(assets) + encodeAddress(account) + encodeAddress(account);
  return sendTransaction({ from: account, to: ONCHAIN_CONFIG.vault, data });
}

export async function requestVaultRedeem(shares) {
  const account = await requireAccount();
  const shareAmount = parseUnits(shares);
  const data = SELECTORS.requestRedeem + encodeUint(shareAmount);
  return sendTransaction({ from: account, to: ONCHAIN_CONFIG.vault, data });
}

export async function claimVaultRedeemShares(shares) {
  const account = await requireAccount();
  const shareAmount = parseUnits(shares);
  const data =
    SELECTORS.redeem + encodeUint(shareAmount) + encodeAddress(account) + encodeAddress(account);
  return sendTransaction({ from: account, to: ONCHAIN_CONFIG.vault, data });
}

export async function claimVaultRedeem(redeemId) {
  const account = await requireAccount();
  const data = SELECTORS.claimRedeem + encodeBytes32(redeemId);
  return sendTransaction({ from: account, to: ONCHAIN_CONFIG.vault, data });
}

export function subscribeWalletChanges(onChange) {
  if (!window.ethereum) return;
  window.ethereum.on?.("accountsChanged", async (accounts) => {
    onChange({
      ok: Boolean(accounts[0]),
      status: accounts[0] ? "Account changed" : "Disconnected",
      account: accounts[0] ?? null,
      chainId: await safeChainId(),
      chainName: "Wallet event",
    });
  });
  window.ethereum.on?.("chainChanged", async (chainId) => {
    onChange({
      ok: true,
      status: chainId === BASE_SEPOLIA.chainId ? "Connected to Base Sepolia" : "Wrong network",
      account: await safeAccount(),
      chainId,
      chainName: chainId === BASE_SEPOLIA.chainId ? "Base Sepolia" : chainId,
    });
  });
}

export function formatUnits(value, decimals = ONCHAIN_CONFIG.decimals) {
  const bigint = BigInt(value ?? 0);
  const base = 10n ** BigInt(decimals);
  const whole = bigint / base;
  const fraction = bigint % base;
  if (fraction === 0n) return whole.toString();
  const trimmed = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${trimmed}`;
}

async function switchToBaseSepolia() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA.chainId }],
    });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [BASE_SEPOLIA],
    });
  }
}

async function ensureBaseSepolia() {
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId !== BASE_SEPOLIA.chainId) await switchToBaseSepolia();
}

async function requireAccount() {
  if (!window.ethereum) throw new Error("No injected wallet");
  await ensureBaseSepolia();
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  const account = accounts[0];
  if (!account) throw new Error("No wallet account selected");
  return normalizeAddress(account);
}

async function callUint(to, data) {
  const result = await window.ethereum.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  return BigInt(result || "0x0").toString();
}

async function sendTransaction(transaction) {
  await ensureBaseSepolia();
  return window.ethereum.request({
    method: "eth_sendTransaction",
    params: [transaction],
  });
}

function parseUnits(value, decimals = ONCHAIN_CONFIG.decimals) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, fraction = ""] = raw.split(".");
  if (fraction.length > decimals) throw new Error(`Too many decimals for ${value}`);
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

function encodeUint(value) {
  const bigint = BigInt(value);
  if (bigint < 0n) throw new Error("Negative uint");
  return bigint.toString(16).padStart(64, "0");
}

function encodeAddress(value) {
  return normalizeAddress(value).slice(2).padStart(64, "0");
}

function encodeBytes32(value) {
  const normalized = String(value ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Expected bytes32 hex value, e.g. 0x followed by 64 hex chars");
  }
  return normalized.slice(2).toLowerCase();
}

function normalizeAddress(value) {
  const normalized = String(value ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`Invalid EVM address: ${value}`);
  }
  return normalized;
}

async function safeChainId() {
  try {
    return await window.ethereum.request({ method: "eth_chainId" });
  } catch {
    return null;
  }
}

async function safeAccount() {
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}
