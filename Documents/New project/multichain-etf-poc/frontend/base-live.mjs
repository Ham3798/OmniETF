const BASE_SEPOLIA = {
  chainId: 84532,
  chainIdHex: "0x14a34",
  chainName: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  explorer: "https://sepolia-explorer.base.org",
  nativeCurrency: {
    name: "ETH",
    symbol: "ETH",
    decimals: 18
  }
};

const SELECTORS = {
  approve: "0x095ea7b3",
  allowance: "0xdd62ed3e",
  mint: "0x40c10f19",
  balanceOf: "0x70a08231",
  decimals: "0x313ce567",
  owner: "0x8da5cb5b",
  asset: "0x38d52e0f",
  bridge: "0xe78cea92",
  totalAssets: "0x01e1d114",
  baseIdleAssets: "0x416e7473",
  solanaManagedAssets: "0xcb10c3fe",
  reservedRedemptionAssets: "0x5e691446",
  previewDeposit: "0xef8b30f7",
  previewRedeem: "0x4cdad506",
  deposit: "0x6e553f65",
  requestRedeem: "0x107703ab",
  bridgeToSolana: "0xd9aae69a",
  recordSolanaNav: "0x592d4571",
  prepareRedemptionLiquidity: "0xfc97ed6d",
  releaseToVault: "0x851e4679",
  settleRedeem: "0x65a4aff2"
};

const TOPICS = {
  assetsBridgedToSolana: "0x9585ef77d599acc8358c23e9b8c01930ec4b2b2a75d8e0601c878153d10df99b",
  redemptionRequested: "0x330ee6b2890cd08327848e029bbb9eecab1ee5930723ae30fd2cad97dccd57c9"
};

const STORAGE_KEY = "multichain-etf-live-addresses";

function strip0x(value) {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function pad32(value) {
  return strip0x(value).padStart(64, "0");
}

function encodeUint(value) {
  return pad32(BigInt(value).toString(16));
}

function encodeAddress(address) {
  return pad32(strip0x(address).toLowerCase());
}

function encodeBytes32Text(value) {
  const bytes = Array.from(new TextEncoder().encode(value)).slice(0, 32);
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex.padEnd(64, "0");
}

function buildData(selector, encodedArgs = []) {
  return selector + encodedArgs.join("");
}

function parseUnits(value, decimals = 6) {
  const normalized = String(value).trim();
  if (!normalized) return 0n;

  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const paddedFraction = (fractionalPart + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(wholePart || "0") * (10n ** BigInt(decimals)) + BigInt(paddedFraction || "0");
}

function formatUnits(value, decimals = 6, displayDecimals = 4) {
  const amount = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = amount % base;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, displayDecimals);
  return `${whole.toString()}.${fractionText.padEnd(displayDecimals, "0")}`;
}

function shortAddress(address) {
  if (!address || address.length < 10) return address || "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function decodeUint(hex) {
  return BigInt(hex || "0x0");
}

function decodeAddress(hex) {
  const padded = strip0x(hex || "0x");
  return `0x${padded.slice(-40)}`;
}

function readTopicUint(topic) {
  return BigInt(topic);
}

async function waitForReceipt(provider, hash, attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash]
    });

    if (receipt) {
      return receipt;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }

  throw new Error("Timed out waiting for transaction receipt");
}

function explorerTxLink(hash) {
  return `${BASE_SEPOLIA.explorer}/tx/${hash}`;
}

function explorerAddressLink(address) {
  return `${BASE_SEPOLIA.explorer}/address/${address}`;
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function readStoredAddresses() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeStoredAddresses(addresses) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
}

export function mountLiveBaseDemo() {
  const provider = window.ethereum;
  const elements = {
    connectWallet: document.querySelector("#live-connect-wallet"),
    switchChain: document.querySelector("#live-switch-chain"),
    saveAddresses: document.querySelector("#live-save-addresses"),
    refreshState: document.querySelector("#live-refresh-state"),
    usdcAddress: document.querySelector("#live-usdc-address"),
    bridgeAddress: document.querySelector("#live-bridge-address"),
    vaultAddress: document.querySelector("#live-vault-address"),
    faucetAmount: document.querySelector("#live-faucet-amount"),
    depositAmount: document.querySelector("#live-deposit-amount"),
    redeemShares: document.querySelector("#live-redeem-shares"),
    bridgeAmount: document.querySelector("#live-bridge-amount"),
    actionId: document.querySelector("#live-action-id"),
    navAmount: document.querySelector("#live-nav-amount"),
    redemptionAssets: document.querySelector("#live-redemption-assets"),
    releaseMessageId: document.querySelector("#live-release-message-id"),
    releaseAmount: document.querySelector("#live-release-amount"),
    settleRedemptionId: document.querySelector("#live-settle-redemption-id"),
    mintUsdc: document.querySelector("#live-mint-usdc"),
    approveUsdc: document.querySelector("#live-approve-usdc"),
    depositVault: document.querySelector("#live-deposit-vault"),
    requestRedeem: document.querySelector("#live-request-redeem"),
    bridgeToSolana: document.querySelector("#live-bridge-solana"),
    recordNav: document.querySelector("#live-record-nav"),
    prepareRedemption: document.querySelector("#live-prepare-redemption"),
    releaseBridge: document.querySelector("#live-release-bridge"),
    settleRedeem: document.querySelector("#live-settle-redeem"),
    walletStatus: document.querySelector("#live-wallet-status"),
    account: document.querySelector("#live-account"),
    chain: document.querySelector("#live-chain"),
    owner: document.querySelector("#live-owner"),
    usdcBalance: document.querySelector("#live-usdc-balance"),
    shareBalance: document.querySelector("#live-share-balance"),
    allowance: document.querySelector("#live-allowance"),
    totalAssets: document.querySelector("#live-total-assets"),
    baseIdle: document.querySelector("#live-base-idle"),
    solanaManaged: document.querySelector("#live-solana-managed"),
    reserved: document.querySelector("#live-reserved"),
    previewDeposit: document.querySelector("#live-preview-deposit"),
    previewRedeem: document.querySelector("#live-preview-redeem"),
    txLog: document.querySelector("#live-tx-log")
  };

  const state = {
    account: "",
    chainId: "",
    isOwner: false,
    addresses: readStoredAddresses(),
    txs: []
  };

  if (elements.usdcAddress) elements.usdcAddress.value = state.addresses.usdc || "";
  if (elements.bridgeAddress) elements.bridgeAddress.value = state.addresses.bridge || "";
  if (elements.vaultAddress) elements.vaultAddress.value = state.addresses.vault || "";

  function logTx(label, hash, detail) {
    state.txs.unshift({
      label,
      hash,
      detail,
      at: new Date().toISOString()
    });
    setStatus(`${label} tx submitted`);
    render();
  }

  function setStatus(message) {
    if (elements.walletStatus) {
      elements.walletStatus.textContent = message;
    }
  }

  function getAddresses() {
    return {
      usdc: elements.usdcAddress.value.trim(),
      bridge: elements.bridgeAddress.value.trim(),
      vault: elements.vaultAddress.value.trim()
    };
  }

  function render() {
    const addresses = getAddresses();
    elements.account.textContent = state.account ? shortAddress(state.account) : "-";
    elements.chain.textContent = state.chainId === BASE_SEPOLIA.chainIdHex ? "Base Sepolia" : (state.chainId || "-");
    elements.owner.textContent = state.isOwner ? "Yes" : "No";

    elements.txLog.innerHTML = state.txs.length > 0
      ? state.txs.map((item) => `
          <article class="timeline-item">
            <time>${new Date(item.at).toLocaleTimeString("ko-KR")}</time>
            <div><strong>${item.label}</strong></div>
            <div>${item.detail || ""}</div>
            <div><a href="${explorerTxLink(item.hash)}" target="_blank" rel="noreferrer">${shortAddress(item.hash)}</a></div>
          </article>
        `).join("")
      : `<article class="timeline-item"><div>실제 testnet 트랜잭션이 여기 표시됩니다.</div></article>`;

    if (!isAddress(addresses.usdc) || !isAddress(addresses.vault) || !isAddress(addresses.bridge)) {
      setStatus("계약 주소 3개를 먼저 입력해 주세요.");
    } else if (!provider) {
      setStatus("EVM wallet provider가 감지되지 않았습니다.");
    } else if (!state.account) {
      setStatus("Connect Wallet을 눌러 지갑을 연결해 주세요.");
    } else if (state.chainId !== BASE_SEPOLIA.chainIdHex) {
      setStatus("Switch Base Sepolia로 테스트넷을 맞춰 주세요.");
    } else if (state.isOwner) {
      setStatus("Owner wallet connected. User flow와 admin flow 모두 실행할 수 있습니다.");
    } else {
      setStatus("User wallet connected. Mint, approve, deposit, redeem request를 실행할 수 있습니다.");
    }
  }

  async function walletRequest(method, params = []) {
    if (!provider) {
      throw new Error("No EVM wallet provider found");
    }

    return provider.request({ method, params });
  }

  async function connectWallet() {
    const accounts = await walletRequest("eth_requestAccounts");
    state.account = accounts[0] || "";
    state.chainId = await walletRequest("eth_chainId");
    await syncOnchainState();
    render();
  }

  async function switchToBaseSepolia() {
    try {
      await walletRequest("wallet_switchEthereumChain", [{ chainId: BASE_SEPOLIA.chainIdHex }]);
    } catch (error) {
      if (error.code === 4902) {
        await walletRequest("wallet_addEthereumChain", [{
          chainId: BASE_SEPOLIA.chainIdHex,
          chainName: BASE_SEPOLIA.chainName,
          rpcUrls: [BASE_SEPOLIA.rpcUrl],
          blockExplorerUrls: [BASE_SEPOLIA.explorer],
          nativeCurrency: BASE_SEPOLIA.nativeCurrency
        }]);
      } else {
        throw error;
      }
    }

    state.chainId = await walletRequest("eth_chainId");
    render();
  }

  async function ethCall(to, data) {
    return walletRequest("eth_call", [{ to, data }, "latest"]);
  }

  async function sendTransaction({ to, data, value = "0x0" }) {
    if (!state.account) {
      await connectWallet();
    }

    const hash = await walletRequest("eth_sendTransaction", [{
      from: state.account,
      to,
      data,
      value
    }]);

    return {
      hash,
      receipt: await waitForReceipt(provider, hash)
    };
  }

  async function readUint(to, selector, args = []) {
    const result = await ethCall(to, buildData(selector, args));
    return decodeUint(result);
  }

  async function readAddress(to, selector) {
    const result = await ethCall(to, buildData(selector));
    return decodeAddress(result);
  }

  async function syncOnchainState() {
    const addresses = getAddresses();

    if (!provider) {
      render();
      return;
    }

    const accounts = await walletRequest("eth_accounts");
    state.account = accounts[0] || "";
    state.chainId = await walletRequest("eth_chainId");

    if (!state.account || !isAddress(addresses.usdc) || !isAddress(addresses.vault)) {
      render();
      return;
    }

    const [
      owner,
      usdcBalance,
      shareBalance,
      allowance,
      totalAssets,
      baseIdle,
      solanaManaged,
      reserved
    ] = await Promise.all([
      readAddress(addresses.vault, SELECTORS.owner),
      readUint(addresses.usdc, SELECTORS.balanceOf, [encodeAddress(state.account)]),
      readUint(addresses.vault, SELECTORS.balanceOf, [encodeAddress(state.account)]),
      readUint(addresses.usdc, SELECTORS.allowance, [encodeAddress(state.account), encodeAddress(addresses.vault)]),
      readUint(addresses.vault, SELECTORS.totalAssets),
      readUint(addresses.vault, SELECTORS.baseIdleAssets),
      readUint(addresses.vault, SELECTORS.solanaManagedAssets),
      readUint(addresses.vault, SELECTORS.reservedRedemptionAssets)
    ]);

    state.isOwner = owner.toLowerCase() === state.account.toLowerCase();
    elements.usdcBalance.textContent = `${formatUnits(usdcBalance, 6)} USDC`;
    elements.shareBalance.textContent = `${formatUnits(shareBalance, 6)} mETF`;
    elements.allowance.textContent = `${formatUnits(allowance, 6)} USDC`;
    elements.totalAssets.textContent = `${formatUnits(totalAssets, 6)} USDC`;
    elements.baseIdle.textContent = `${formatUnits(baseIdle, 6)} USDC`;
    elements.solanaManaged.textContent = `${formatUnits(solanaManaged, 6)} USDC`;
    elements.reserved.textContent = `${formatUnits(reserved, 6)} USDC`;

    const depositAmount = parseUnits(elements.depositAmount.value || "0", 6);
    const redeemShares = parseUnits(elements.redeemShares.value || "0", 6);

    if (depositAmount > 0n) {
      const preview = await readUint(addresses.vault, SELECTORS.previewDeposit, [encodeUint(depositAmount)]);
      elements.previewDeposit.textContent = `${formatUnits(preview, 6)} mETF`;
    } else {
      elements.previewDeposit.textContent = "-";
    }

    if (redeemShares > 0n) {
      const preview = await readUint(addresses.vault, SELECTORS.previewRedeem, [encodeUint(redeemShares)]);
      elements.previewRedeem.textContent = `${formatUnits(preview, 6)} USDC`;
    } else {
      elements.previewRedeem.textContent = "-";
    }

    render();
  }

  async function mintUsdc() {
    const addresses = getAddresses();
    const amount = parseUnits(elements.faucetAmount.value || "0", 6);
    const { hash } = await sendTransaction({
      to: addresses.usdc,
      data: buildData(SELECTORS.mint, [encodeAddress(state.account), encodeUint(amount)])
    });

    logTx("Mint Test USDC", hash, `Minted ${formatUnits(amount, 6)} USDC to ${shortAddress(state.account)}`);
    await syncOnchainState();
  }

  async function approveUsdc() {
    const addresses = getAddresses();
    const amount = parseUnits(elements.depositAmount.value || "0", 6);
    const { hash } = await sendTransaction({
      to: addresses.usdc,
      data: buildData(SELECTORS.approve, [encodeAddress(addresses.vault), encodeUint(amount)])
    });

    logTx("Approve USDC", hash, `Approved ${formatUnits(amount, 6)} USDC to Vault`);
    await syncOnchainState();
  }

  async function depositToVault() {
    const addresses = getAddresses();
    const amount = parseUnits(elements.depositAmount.value || "0", 6);
    const { hash } = await sendTransaction({
      to: addresses.vault,
      data: buildData(SELECTORS.deposit, [encodeUint(amount), encodeAddress(state.account)])
    });

    logTx("Deposit To Vault", hash, `Deposited ${formatUnits(amount, 6)} USDC from ${shortAddress(state.account)}`);
    await syncOnchainState();
  }

  async function requestRedeem() {
    const addresses = getAddresses();
    const shares = parseUnits(elements.redeemShares.value || "0", 6);
    const { hash, receipt } = await sendTransaction({
      to: addresses.vault,
      data: buildData(SELECTORS.requestRedeem, [encodeUint(shares), encodeAddress(state.account)])
    });

    const redemptionLog = receipt.logs.find((log) =>
      log.address.toLowerCase() === addresses.vault.toLowerCase() &&
      log.topics[0] === TOPICS.redemptionRequested
    );

    if (redemptionLog) {
      const redemptionId = readTopicUint(redemptionLog.topics[1]).toString();
      const data = strip0x(redemptionLog.data);
      const assetsHex = `0x${data.slice(64, 128)}`;
      const assets = decodeUint(assetsHex);
      elements.settleRedemptionId.value = redemptionId;
      elements.redemptionAssets.value = formatUnits(assets, 6, 6);
      elements.releaseAmount.value = formatUnits(assets, 6, 6);
      logTx("Request Redeem", hash, `Redemption #${redemptionId} for ${formatUnits(assets, 6)} USDC`);
    } else {
      logTx("Request Redeem", hash, `Redeem request sent for ${formatUnits(shares, 6)} mETF`);
    }

    await syncOnchainState();
  }

  async function bridgeToSolana() {
    const addresses = getAddresses();
    const amount = parseUnits(elements.bridgeAmount.value || "0", 6);
    const actionId = elements.actionId.value.trim() || "live-bridge";
    const { hash, receipt } = await sendTransaction({
      to: addresses.vault,
      data: buildData(SELECTORS.bridgeToSolana, [encodeUint(amount), encodeBytes32Text(actionId)])
    });

    const bridgeLog = receipt.logs.find((log) =>
      log.address.toLowerCase() === addresses.vault.toLowerCase() &&
      log.topics[0] === TOPICS.assetsBridgedToSolana
    );

    if (bridgeLog) {
      const messageId = readTopicUint(bridgeLog.topics[1]).toString();
      elements.releaseMessageId.value = messageId;
      elements.releaseAmount.value = formatUnits(amount, 6, 6);
      logTx("Bridge To Solana", hash, `Bridge message #${messageId} queued for ${formatUnits(amount, 6)} USDC`);
    } else {
      logTx("Bridge To Solana", hash, `Bridge out ${formatUnits(amount, 6)} USDC`);
    }

    await syncOnchainState();
  }

  async function recordNav() {
    const addresses = getAddresses();
    const amount = parseUnits(elements.navAmount.value || "0", 6);
    const { hash } = await sendTransaction({
      to: addresses.vault,
      data: buildData(SELECTORS.recordSolanaNav, [encodeUint(amount)])
    });

    logTx("Record Solana NAV", hash, `Updated Solana NAV to ${formatUnits(amount, 6)} USDC`);
    await syncOnchainState();
  }

  async function prepareRedemption() {
    const addresses = getAddresses();
    const amount = parseUnits(elements.redemptionAssets.value || "0", 6);
    const { hash } = await sendTransaction({
      to: addresses.vault,
      data: buildData(SELECTORS.prepareRedemptionLiquidity, [encodeUint(amount)])
    });

    logTx("Prepare Redemption", hash, `Prepared ${formatUnits(amount, 6)} USDC on Solana side`);
    await syncOnchainState();
  }

  async function releaseFromBridge() {
    const addresses = getAddresses();
    const messageId = BigInt(elements.releaseMessageId.value || "0");
    const amount = parseUnits(elements.releaseAmount.value || "0", 6);
    const { hash } = await sendTransaction({
      to: addresses.bridge,
      data: buildData(SELECTORS.releaseToVault, [encodeUint(messageId), encodeUint(amount)])
    });

    logTx("Release From Bridge", hash, `Released bridge message #${messageId.toString()} back to Vault`);
    await syncOnchainState();
  }

  async function settleRedeem() {
    const addresses = getAddresses();
    const redemptionId = BigInt(elements.settleRedemptionId.value || "0");
    const { hash } = await sendTransaction({
      to: addresses.vault,
      data: buildData(SELECTORS.settleRedeem, [encodeUint(redemptionId)])
    });

    logTx("Settle Redeem", hash, `Settled redemption #${redemptionId.toString()}`);
    await syncOnchainState();
  }

  function saveAddresses() {
    const addresses = getAddresses();
    if (!isAddress(addresses.usdc) || !isAddress(addresses.vault) || !isAddress(addresses.bridge)) {
      setStatus("유효한 0x 주소 3개를 입력해 주세요.");
      return;
    }
    writeStoredAddresses(addresses);
    state.addresses = addresses;
    render();
  }

  elements.connectWallet?.addEventListener("click", () => connectWallet().catch((error) => setStatus(error.message)));
  elements.switchChain?.addEventListener("click", () => switchToBaseSepolia().catch((error) => setStatus(error.message)));
  elements.saveAddresses?.addEventListener("click", saveAddresses);
  elements.refreshState?.addEventListener("click", () => syncOnchainState().catch((error) => setStatus(error.message)));
  elements.mintUsdc?.addEventListener("click", () => mintUsdc().catch((error) => setStatus(error.message)));
  elements.approveUsdc?.addEventListener("click", () => approveUsdc().catch((error) => setStatus(error.message)));
  elements.depositVault?.addEventListener("click", () => depositToVault().catch((error) => setStatus(error.message)));
  elements.requestRedeem?.addEventListener("click", () => requestRedeem().catch((error) => setStatus(error.message)));
  elements.bridgeToSolana?.addEventListener("click", () => bridgeToSolana().catch((error) => setStatus(error.message)));
  elements.recordNav?.addEventListener("click", () => recordNav().catch((error) => setStatus(error.message)));
  elements.prepareRedemption?.addEventListener("click", () => prepareRedemption().catch((error) => setStatus(error.message)));
  elements.releaseBridge?.addEventListener("click", () => releaseFromBridge().catch((error) => setStatus(error.message)));
  elements.settleRedeem?.addEventListener("click", () => settleRedeem().catch((error) => setStatus(error.message)));

  [elements.depositAmount, elements.redeemShares].forEach((input) => {
    input?.addEventListener("input", () => syncOnchainState().catch(() => undefined));
  });

  if (provider?.on) {
    provider.on("accountsChanged", () => syncOnchainState().catch(() => undefined));
    provider.on("chainChanged", () => syncOnchainState().catch(() => undefined));
  }

  render();
  syncOnchainState().catch(() => undefined);
}
