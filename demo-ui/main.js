import {
  approveUsdc,
  claimVaultDeposit,
  claimVaultRedeemShares,
  connectEvmWallet,
  formatUnits,
  ONCHAIN_CONFIG,
  readLiveVaultState,
  requestVaultDeposit,
  requestVaultRedeem,
  subscribeWalletChanges,
} from "./wallet.js";

const commandLabels = {
  "portfolio:allocate": "Allocate basket",
  "portfolio:nav": "Print NAV",
  "portfolio:redeem": "Quote redeem",
  "portfolio:execute-redeem": "Execute mock redeem",
  "vault:demo": "Vault claim helper",
  "demo:e2e": "Run CLI E2E",
};

const visibleFlow = [
  { id: "approve", step: "01", label: "Approve", lane: "Base", value: "USDC allowance", status: "ready" },
  { id: "buy", step: "02", label: "Buy", lane: "CCTP", value: "USDC settlement", status: "ready" },
  { id: "claim", step: "03", label: "Claim", lane: "Base", value: "mETF mint", status: "ready" },
  { id: "redeem", step: "04", label: "Redeem", lane: "Base", value: "mETF escrow", status: "ready" },
];

const SOLANA_CUSTODY = {
  program: "4LaatT5FGgWMkFfT3zLUSEnsaWegk52a2nEwk8VRR881",
  state: "BTZCDfAhtoMCiGBWZ78KQnsoML2cKRcB9f2nJcC1yDcg",
  rpc: "https://api.devnet.solana.com",
};

const CCTP_DESTINATION = {
  program: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
  mintAccount: "9y7ns4FyHSFscz5yvgAfchDVzr9VUsyDSx56VttABut",
};

const SESSION_TX_KEY = "omnietf.sessionTx.v1";
const KNOWN_TOPICS = {
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer",
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925": "Approval",
  "0xbb58420bb8ce44e11b84e214cc0de10ce5e7c24d0355b2815c3d758b514cae72": "DepositRequest",
  "0xc01278e1832ef1cb1f630c3ab767b991d386400c30db22fa9f579984ebbd8c8b": "DepositRouteSet",
  "0xe12b0cc0423fc38d84f9841aed8e69593cf02a71fd1d94dff25f97de6c8cf3c8": "DepositSettled",
  "0x9d6948bba07ce0407764dc97ab6fba5acc396a8e58713b4bb69386cf596af8eb": "DepositExecuted",
  "0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7": "Deposit",
  "0x1fdc681a13d8c5da54e301c7ce6542dcde4581e4725043fdab2db12ddc574506": "RedeemRequest",
  "0x67282ca9eb8524fef14fff2a7cfdf248a614e297d68ab422f1b90e94fe0a03c6": "RedeemFulfilled",
  "0xd2aa3933e2b856b757d96d88c72d10773c4ce235bc0601af2519bbf018bb4b04": "RedeemPayoutFunded",
  "0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db": "Withdraw",
  "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036": "MessageSent",
  "0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5": "DepositForBurn",
};

const state = {
  busy: false,
  liveBusy: false,
  wallet: null,
  lastData: null,
  lastLiveState: null,
  lastDepositTx: null,
  cctpProof: {},
  livePollId: null,
  cctpPollId: null,
  cctpPollCount: 0,
  selectedStageId: null,
  selectedCodeId: null,
  lifecycle: [],
  staticMode: false,
  sessionTxs: loadSessionTxs(),
};

document.getElementById("connectWalletButton").addEventListener("click", connectWallet);
document.getElementById("liveApproveButton").addEventListener("click", () => runLiveAction("approve"));
document.getElementById("liveRequestDepositButton").addEventListener("click", () => runLiveAction("requestDeposit"));
document.getElementById("liveClaimDepositButton").addEventListener("click", () => runLiveAction("claimDeposit"));
document.getElementById("liveRequestRedeemButton").addEventListener("click", () => runLiveAction("requestRedeem"));
document.getElementById("clearSessionButton").addEventListener("click", clearSessionTxs);
subscribeWalletChanges(renderWalletState);

await refresh();
await refreshCctpDestinationState();
await refreshSolanaReceiverState();
renderSessionTxs();

async function refresh() {
  const data = await fetchState();
  render(data);
}

function render(data) {
  state.lastData = data;
  document.getElementById("updatedAt").textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString()}`;
  document.getElementById("navMetric").textContent = "-";
  document.getElementById("sharesMetric").textContent = "-";
  document.getElementById("assetsMetric").textContent = "-";

  state.lifecycle = visibleFlow;
  state.staticMode = Boolean(data.staticMode);
  state.selectedStageId ??= visibleFlow[0]?.id ?? null;
  state.selectedCodeId ??= data.codeSnippets?.[0]?.id ?? null;
  renderPipeline(visibleFlow);
  renderStageDetail(visibleFlow.find((item) => item.id === state.selectedStageId) ?? visibleFlow[0]);
  renderCcipMessages(data.ccipMessages ?? []);
  renderEvidence(data.lifecycle);
  renderCodeSnippets(data.codeSnippets ?? []);
  renderActions(data.commands);
  renderAssets(data.nav?.assets ?? data.ledger?.portfolio?.assets ?? []);
  renderKv("redeemQuote", {
    Shares: data.redeemQuote?.shares ?? "0.5",
    "Redeemable USDC": data.redeemQuote?.redeemableUsdc ?? "-",
    "Settlement mode": data.settlement?.mode ?? "quote only",
    "Next command": data.settlement?.nextCommand ?? "Run portfolio:execute-redeem",
  });
  renderKv("vaultState", {
    Address: data.vault.address,
    "Total supply": data.vault.totalSupply,
    "User balance": data.vault.userBalance,
    "Managed assets": data.vault.totalManagedAssets,
    "Ledger file": data.files.ledgerExists ? data.files.ledgerPath : "missing",
  });
  renderSettlementProofState({
    Attestation: state.lastDepositTx ? "fresh buy tx ready" : "no fresh buy",
    Tx: state.lastDepositTx ? txLink(state.lastDepositTx, "Base tx") : "-",
    Destination: solanaAccountLink("Circle CCTP", CCTP_DESTINATION.program),
    Mint: solanaAccountLink("USDC account", CCTP_DESTINATION.mintAccount),
    "Latest mint": "checking...",
    Balance: "-",
  });
  renderSolanaReserveState({
    Program: solanaAccountLink("4Laat...R881", SOLANA_CUSTODY.program),
    State: solanaAccountLink("BTZC...yDcg", SOLANA_CUSTODY.state),
    Rail: "CCIP receiver",
    Messages: "-",
    Basket: "-",
  });
  updateActionAvailability(null);
}

function renderCcipMessages(messages) {
  const root = document.getElementById("ccipGrid");
  root.innerHTML = "";
  for (const message of messages) {
    const card = document.createElement("a");
    card.className = "ccip-card";
    card.href = message.url;
    card.target = "_blank";
    card.rel = "noreferrer";
    card.innerHTML = `
      <span>${escapeHtml(message.kind)}</span>
      <strong>${escapeHtml(message.status)}</strong>
      <small>${escapeHtml(message.tokenAmounts)}</small>
    `;
    root.appendChild(card);
  }
}

async function fetchState() {
  try {
    return await fetchJson("/api/state");
  } catch {
    const data = await fetchJson("/state.json");
    return { ...data, staticMode: true };
  }
}

function renderPipeline(items) {
  const root = document.getElementById("pipeline");
  root.innerHTML = "";
  for (const item of items) {
    const element = document.createElement("div");
    element.className = `stage-card${item.id === state.selectedStageId ? " selected" : ""}`;
    element.dataset.lane = item.lane;
    element.innerHTML = `
      <div class="stage-step">
        <span class="step-num">${escapeHtml(item.step ?? "")}</span>
        <span class="lane-dot"></span>
      </div>
      <h4>${escapeHtml(item.label)}</h4>
      <div class="stage-value">${escapeHtml(item.value ?? item.status)}</div>
    `;
    root.appendChild(element);
  }
}

function renderStageDetail(item) {
  const root = document.getElementById("stageDetail");
  if (!item) return;
  root.innerHTML = `
    <h3>${escapeHtml(item.label)}</h3>
    <div class="stage-meta">
      <div><span>Rail</span><strong>${escapeHtml(item.rail ?? "-")}</strong></div>
      <div><span>Value</span><strong>${escapeHtml(item.value ?? "-")}</strong></div>
    </div>
  `;
}

function renderEvidence(items) {
  const root = document.getElementById("evidenceGrid");
  root.innerHTML = "";
  for (const item of items) {
    const card = document.createElement("a");
    card.href = item.url;
    card.target = "_blank";
    card.rel = "noreferrer";
    card.className = "evidence-card";
    card.dataset.lane = item.lane;
    card.innerHTML = `
      <span>${escapeHtml(item.step)}</span>
      <strong>${escapeHtml(item.label)}</strong>
    `;
    root.appendChild(card);
  }
}

function renderCodeSnippets(snippets) {
  const tabs = document.getElementById("codeTabs");
  tabs.innerHTML = "";
  if (!snippets.length) return;

  const selected = snippets.find((snippet) => snippet.id === state.selectedCodeId) ?? snippets[0];
  state.selectedCodeId = selected.id;

  for (const snippet of snippets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = snippet.id === selected.id ? "selected" : "";
    button.innerHTML = `<strong>${escapeHtml(snippet.title)}</strong><span>${escapeHtml(snippet.file)}:${escapeHtml(snippet.lines)}</span>`;
    button.addEventListener("click", () => {
      state.selectedCodeId = snippet.id;
      renderCodeSnippets(snippets);
    });
    tabs.appendChild(button);
  }

  document.getElementById("codeFile").textContent = `${selected.file}:${selected.lines}`;
  document.getElementById("codeTitle").textContent = selected.title;
  document.getElementById("codeLines").textContent = `lines ${selected.lines}`;
  document.getElementById("codeDescription").textContent = selected.description;
  document.getElementById("codeBlock").textContent = selected.code;
}

function renderActions(commands) {
  const root = document.getElementById("actions");
  root.innerHTML = "";
  for (const command of commands) {
    const button = document.createElement("button");
    button.className = command === "demo:e2e" ? "primary" : "";
    button.textContent = commandLabels[command] ?? command;
    button.disabled = state.busy;
    button.addEventListener("click", () => runCommand(command));
    root.appendChild(button);
  }
}

function renderAssets(assets) {
  const root = document.getElementById("assetList");
  root.innerHTML = "";
  if (!assets.length) {
    root.textContent = "No ledger yet. Run Allocate basket.";
    return;
  }
  for (const asset of assets) {
    const weight = asset.currentWeightBps ?? asset.targetWeightBps ?? 0;
    const width = Math.max(0, Math.min(100, weight / 100));
    const element = document.createElement("div");
    element.className = "asset";
    element.innerHTML = `
      <strong>${escapeHtml(asset.symbol)}</strong>
      <p class="muted">${formatBps(weight)}</p>
      <div class="asset-bar"><div style="width:${width}%"></div></div>
    `;
    root.appendChild(element);
  }
}

function renderKv(id, values) {
  const root = document.getElementById(id);
  root.innerHTML = "";
  for (const [key, value] of Object.entries(values)) {
    const row = document.createElement("div");
    row.innerHTML = `<span>${escapeHtml(key)}</span><strong>${formatKvValue(value)}</strong>`;
    root.appendChild(row);
  }
}

async function runCommand(command) {
  if (state.staticMode) {
    document.getElementById("commandLog").textContent =
      `Static Vercel mode.\nRun locally to reproduce:\n\nnpm run ${command}`;
    return;
  }
  state.busy = true;
  document.getElementById("commandLog").textContent = `Running ${command}...`;
  renderActions(Object.keys(commandLabels));
  try {
    const result = await fetchJson("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command }),
    });
    document.getElementById("commandLog").textContent = result.output || JSON.stringify(result, null, 2);
    render(result.state);
  } catch (error) {
    document.getElementById("commandLog").textContent = error.stack || error.message;
  } finally {
    state.busy = false;
    const data = await fetchState();
    state.selectedStageId ??= data.lifecycle[0]?.id ?? null;
    render(data);
  }
}

async function connectWallet() {
  const button = document.getElementById("connectWalletButton");
  try {
    const wallet = await connectEvmWallet();
    state.wallet = wallet;
    renderWalletState(wallet);
    button.textContent = wallet.account ? shortAddress(wallet.account) : wallet.status;
    button.disabled = !wallet.ok && !window.ethereum;
    if (wallet.account) {
      await refreshLiveState();
      startLivePolling();
    }
  } catch (error) {
    button.textContent = "Wallet rejected";
    renderWalletState({
      ok: false,
      status: "Wallet connection failed",
      account: null,
      chainId: null,
      chainName: error.message,
    });
  }
}

function renderWalletState(wallet) {
  state.wallet = wallet;
  const root = document.getElementById("walletState");
  root.className = `wallet-state${wallet.ok ? " connected" : ""}`;
  root.innerHTML = `
    <span>${escapeHtml(wallet.status)}</span>
    <strong>${escapeHtml(wallet.account ? shortAddress(wallet.account) : wallet.chainName ?? "No account")}</strong>
    <small>${escapeHtml(wallet.chainId ? `chainId ${wallet.chainId}` : "Base Sepolia target")}</small>
  `;
}

async function refreshLiveState() {
  return refreshLiveStateInternal({ silent: false });
}

async function refreshLiveStateInternal({ silent }) {
  const account = state.wallet?.account ?? (await safeConnectedAccount());
  if (!account) {
    renderKv("liveContractState", {
      "Wallet USDC": "-",
      "mETF balance": "-",
      Claimable: "-",
    });
    updateActionAvailability(null);
    return null;
  }
  try {
    if (!state.wallet?.account) {
      renderWalletState({
        ok: true,
        status: "Connected to Base Sepolia",
        account,
        chainId: ONCHAIN_CONFIG.chain.chainId,
        chainName: "Base Sepolia",
      });
      document.getElementById("connectWalletButton").textContent = shortAddress(account);
    }
    if (!silent) writeLiveLog("Reading Base Sepolia vault state...");
    const live = await readLiveVaultState(account);
    state.lastLiveState = live;
    document.getElementById("liveClaimAssets").value = formatUnits(live.maxDeposit);
    document.getElementById("liveRedeemShares").value = formatUnits(live.shareBalance);
    document.getElementById("navMetric").textContent = live.totalSupply === "0"
      ? "1"
      : formatNav(live.totalManagedAssets, live.totalSupply);
    document.getElementById("sharesMetric").textContent = formatUnits(live.totalSupply);
    document.getElementById("assetsMetric").textContent = formatUnits(live.totalManagedAssets);
    renderKv("liveContractState", {
      Vault: shortAddress(live.vault),
      "Wallet USDC": formatUnits(live.usdcBalance),
      "USDC allowance": formatUnits(live.usdcAllowance),
      "mETF balance": formatUnits(live.shareBalance),
      Claimable: formatUnits(live.maxDeposit),
    });
    updateActionAvailability(live);
    if (!silent) writeLiveLog("Live state refreshed.");
    return live;
  } catch (error) {
    if (!silent) writeLiveLog(error.stack || error.message);
    updateActionAvailability(null);
    return null;
  }
}

function startLivePolling() {
  if (state.livePollId) window.clearInterval(state.livePollId);
  state.livePollId = window.setInterval(() => {
    if (!state.liveBusy) void refreshLiveStateInternal({ silent: true });
  }, 8000);
}

async function refreshSettlementProofs() {
  const tx = state.lastDepositTx;
  if (!tx || !tx.startsWith("0x")) {
    renderSettlementProofState({
      Attestation: "no fresh buy",
      Destination: solanaAccountLink("Circle CCTP", CCTP_DESTINATION.program),
      Mint: solanaAccountLink("USDC account", CCTP_DESTINATION.mintAccount),
      "Latest mint": "checking...",
      Balance: "-",
    });
    await refreshCctpDestinationState();
    return false;
  }
  try {
    renderSettlementProofState({
      Attestation: "fetching...",
      Tx: txLink(tx, "Base tx"),
      Destination: solanaAccountLink("Circle CCTP", CCTP_DESTINATION.program),
      Mint: solanaAccountLink("USDC account", CCTP_DESTINATION.mintAccount),
      "Latest mint": "checking...",
      Balance: "-",
    });
    const url = `https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=${tx}`;
    const response = await fetch(url);
    const data = await response.json();
    const message = data.messages?.[0];
    const status = message?.status ?? data.error ?? "unknown";
    const complete = status === "complete";
    renderSettlementProofState({
      Attestation: status,
      "Has message": Boolean(message?.message),
      "Has attestation": Boolean(message?.attestation && message.attestation !== "PENDING"),
      Tx: txLink(tx, "Base tx"),
      Destination: solanaAccountLink("Circle CCTP", CCTP_DESTINATION.program),
      Mint: solanaAccountLink("USDC account", CCTP_DESTINATION.mintAccount),
      "Latest mint": "checking...",
      Balance: "-",
    });
    await refreshCctpDestinationState();
    if (complete) stopCctpPolling();
    await refreshSolanaReceiverState();
    return complete;
  } catch (error) {
    renderSettlementProofState({
      Attestation: "Circle API failed",
      Error: error.message,
      Destination: solanaAccountLink("Circle CCTP", CCTP_DESTINATION.program),
      Mint: solanaAccountLink("USDC account", CCTP_DESTINATION.mintAccount),
      "Latest mint": "checking...",
      Balance: "-",
    });
    await refreshCctpDestinationState();
    await refreshSolanaReceiverState();
    return false;
  }
}

function renderSettlementProofState(values) {
  state.cctpProof = values;
  renderKv("settlementProofState", values);
}

async function refreshCctpDestinationState() {
  try {
    const [balanceResult, signatureResult] = await Promise.all([
      solanaRpc("getTokenAccountBalance", [CCTP_DESTINATION.mintAccount]),
      solanaRpc("getSignaturesForAddress", [CCTP_DESTINATION.mintAccount, { limit: 1 }]),
    ]);
    const latest = signatureResult?.[0];
    renderSettlementProofState({
      ...state.cctpProof,
      "Latest mint": latest ? solanaTxLink("mint tx", latest.signature) : "not received",
      Balance: balanceResult?.value?.uiAmountString ?? "-",
    });
  } catch {
    renderSettlementProofState({
      ...state.cctpProof,
      "Latest mint": "RPC check failed",
    });
  }
}

async function refreshSolanaReserve() {
  await refreshSolanaReceiverState();
}

function renderSolanaReserveState(values) {
  renderKv("solanaReserveState", values);
}

async function refreshSolanaReceiverState() {
  try {
    const data = await solanaRpc("getAccountInfo", [SOLANA_CUSTODY.state, { encoding: "base64" }]);
    const encoded = data.value?.data?.[0];
    if (!encoded) throw new Error("state account not found");
    const custody = decodeCustodyState(encoded);
    renderSolanaReserveState({
      Program: solanaAccountLink("4Laat...R881", SOLANA_CUSTODY.program),
      State: solanaAccountLink("BTZC...yDcg", SOLANA_CUSTODY.state),
      Rail: "CCIP receiver",
      Messages: custody.messageCount,
      Basket: `${custody.aaplUnits}/${custody.tslaUnits}/${custody.nvdaUnits}`,
      Redeem: custody.totalRedeemUnits,
      "Last CCIP": custody.lastMessageId === "0x0000000000000000000000000000000000000000000000000000000000000000"
        ? "-"
        : linkHtml("message", `https://ccip.chain.link/msg/${custody.lastMessageId}`),
    });
  } catch (error) {
    renderSolanaReserveState({
      Program: solanaAccountLink("4Laat...R881", SOLANA_CUSTODY.program),
      State: solanaAccountLink("BTZC...yDcg", SOLANA_CUSTODY.state),
      Rail: "CCIP receiver",
      Messages: "-",
      Basket: "-",
      Redeem: "-",
      Status: "RPC read failed",
    });
  }
}

async function runLiveAction(action) {
  if (state.liveBusy) return;
  state.liveBusy = true;
  setLiveButtonsDisabled(true);
  try {
    const depositAmount = inputValue("liveDepositAmount");
    const solanaRecipient = inputValue("liveSolanaRecipient");
    const maxFee = inputValue("liveMaxFee");
    let claimAssets = inputValue("liveClaimAssets");
    let redeemShares = inputValue("liveRedeemShares");
    let txHash;
    if (action === "approve") {
      writeLiveLog(`Submitting USDC approve for ${depositAmount} USDC...`);
      txHash = await approveUsdc(depositAmount);
      await recordEvmTx("Approve", txHash, { rail: "Base", note: `${depositAmount} USDC allowance` });
    } else if (action === "requestDeposit") {
      writeLiveLog(`Submitting requestDeposit for ${depositAmount} USDC...`);
      txHash = await requestVaultDeposit(depositAmount, solanaRecipient, maxFee);
      await recordEvmTx("Buy", txHash, { rail: "Base/CCTP", note: `${depositAmount} USDC burn request` });
      state.lastDepositTx = txHash;
      startCctpPolling();
      writeLiveLog(
        `Buy tx submitted:\n${txHash}\n\nWaiting for CCTP attestation, Solana receiveMessage, and Base reporter execution...`,
      );
      const relay = await runLiveRelayer("settle-deposit", txHash);
      if (relay?.result?.solanaReceiveTx) {
        recordExternalTx("Solana receive", relay.result.solanaReceiveTx, {
          chain: "Solana",
          rail: "CCTP",
          note: `${formatUnits(relay.result.receivedUnits ?? "0")} USDC minted`,
          url: `https://explorer.solana.com/tx/${relay.result.solanaReceiveTx}?cluster=devnet`,
        });
        writeLiveLog(
          `Buy settled end-to-end.\n\nBase tx: ${txHash}\nSolana receive: ${relay.result.solanaReceiveTx}\nClaimable: ${formatUnits(relay.result.maxDeposit)} USDC`,
        );
      }
    } else if (action === "claimDeposit") {
      writeLiveLog("Reading claimable assets from Base Sepolia...");
      const live = await refreshLiveStateInternal({ silent: true });
      claimAssets = formatUnits(live?.maxDeposit ?? "0");
      if (!Number(claimAssets)) {
        writeLiveLog("Claimable = 0. Reporter finalization is not onchain yet.");
        return;
      }
      writeLiveLog(`Submitting deposit claim for ${claimAssets} assets...`);
      txHash = await claimVaultDeposit(claimAssets);
      await recordEvmTx("Claim", txHash, { rail: "Base", note: `${claimAssets} assets claimed` });
    } else if (action === "requestRedeem") {
      writeLiveLog("Reading redeemable mETF balance from Base Sepolia...");
      const live = await refreshLiveStateInternal({ silent: true });
      redeemShares = formatUnits(live?.shareBalance ?? "0");
      if (!Number(redeemShares)) {
        writeLiveLog("mETF balance = 0. Nothing to redeem.");
        return;
      }
      writeLiveLog(`Submitting requestRedeem for ${redeemShares} shares...`);
      txHash = await requestVaultRedeem(redeemShares);
      await recordEvmTx("Redeem request", txHash, { rail: "Base", note: `${redeemShares} mETF escrowed` });
      writeLiveLog(`Redeem request submitted:\n${txHash}\n\nFunding redeem payout through reporter...`);
      const relay = await runLiveRelayer("fulfill-redeem", txHash);
      const fundedShares = formatUnits(relay?.result?.maxRedeem ?? "0");
      if (Number(fundedShares)) {
        writeLiveLog(`Redeem payout ready. Claiming ${fundedShares} mETF worth of USDC...`);
        txHash = await claimVaultRedeemShares(fundedShares);
        await recordEvmTx("Redeem claim", txHash, { rail: "Base", note: `${fundedShares} USDC paid` });
      }
    } else {
      throw new Error(`Unknown live action: ${action}`);
    }
    writeLiveLog(`Transaction submitted:\n${txHash}\n\nBasescan:\nhttps://sepolia.basescan.org/tx/${txHash}`);
    await refreshLiveState();
    if (action === "requestDeposit") {
      const cctpComplete = await refreshSettlementProofs();
      if (!cctpComplete) await refreshSolanaReserve();
    }
    if (action === "requestRedeem") await refreshSolanaReceiverState();
  } catch (error) {
    writeLiveLog(error.stack || error.message);
  } finally {
    state.liveBusy = false;
    setLiveButtonsDisabled(false);
  }
}

async function runLiveRelayer(command, txHash) {
  const endpoint = command === "settle-deposit"
    ? "/api/live/settle-deposit"
    : "/api/live/fulfill-redeem";
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    const result = await fetchJson(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash }),
    });
    if (!result.pending) return result;
    writeLiveLog(
      `Waiting for Circle attestation...\n\nBase tx: ${txHash}\nStatus: ${result.status ?? "pending"}\nAttempt ${attempt}/45`,
    );
    await delay(8_000);
  }
  throw new Error("Circle attestation did not complete in time.");
}

function startCctpPolling() {
  stopCctpPolling();
  state.cctpPollCount = 0;
  state.cctpPollId = window.setInterval(async () => {
    state.cctpPollCount += 1;
    const complete = await refreshSettlementProofs();
    if (complete || state.cctpPollCount >= 30) stopCctpPolling();
  }, 8000);
}

function stopCctpPolling() {
  if (!state.cctpPollId) return;
  window.clearInterval(state.cctpPollId);
  state.cctpPollId = null;
}

function setLiveButtonsDisabled(disabled) {
  for (const id of [
    "liveApproveButton",
    "liveRequestDepositButton",
    "liveClaimDepositButton",
    "liveRequestRedeemButton",
  ]) {
    document.getElementById(id).disabled = disabled;
  }
}

function updateActionAvailability(live) {
  if (state.liveBusy) return;
  const connected = Boolean(live);
  document.getElementById("liveApproveButton").disabled = !connected;
  document.getElementById("liveRequestDepositButton").disabled = !connected;
  document.getElementById("liveClaimDepositButton").disabled = !connected || BigInt(live?.maxDeposit ?? 0) === 0n;
  document.getElementById("liveRequestRedeemButton").disabled = !connected || BigInt(live?.shareBalance ?? 0) === 0n;
}

function inputValue(id) {
  return document.getElementById(id).value.trim();
}

function writeLiveLog(message) {
  document.getElementById("liveLog").textContent = message;
}

async function recordEvmTx(action, hash, meta = {}) {
  const entry = upsertSessionTx({
    id: hash,
    hash,
    action,
    chain: "Base Sepolia",
    status: "pending",
    rail: meta.rail ?? "Base",
    note: meta.note ?? "",
    url: `https://sepolia.basescan.org/tx/${hash}`,
    createdAt: new Date().toISOString(),
    logs: [],
  });
  try {
    const receipt = await waitForEvmReceipt(hash);
    updateSessionTx(hash, {
      status: receipt.status === "0x1" ? "confirmed" : "failed",
      blockNumber: hexToDecimal(receipt.blockNumber),
      gasUsed: hexToDecimal(receipt.gasUsed),
      logs: summarizeLogs(receipt.logs ?? []),
    });
  } catch (error) {
    updateSessionTx(hash, { status: "receipt pending", error: error.message });
  }
  return entry;
}

function recordExternalTx(action, hash, meta = {}) {
  upsertSessionTx({
    id: hash,
    hash,
    action,
    chain: meta.chain ?? "Solana",
    status: "confirmed",
    rail: meta.rail ?? "CCTP",
    note: meta.note ?? "",
    url: meta.url ?? "#",
    createdAt: new Date().toISOString(),
    logs: [],
  });
}

function upsertSessionTx(entry) {
  const existingIndex = state.sessionTxs.findIndex((item) => item.hash === entry.hash);
  if (existingIndex === -1) {
    state.sessionTxs = [entry, ...state.sessionTxs].slice(0, 24);
  } else {
    state.sessionTxs[existingIndex] = { ...state.sessionTxs[existingIndex], ...entry };
  }
  persistSessionTxs();
  renderSessionTxs();
  return entry;
}

function updateSessionTx(hash, patch) {
  state.sessionTxs = state.sessionTxs.map((item) => item.hash === hash ? { ...item, ...patch } : item);
  persistSessionTxs();
  renderSessionTxs();
}

function renderSessionTxs() {
  const root = document.getElementById("sessionTxStack");
  if (!root) return;
  if (!state.sessionTxs.length) {
    root.innerHTML = `<div class="empty-stack">No session tx yet.</div>`;
    return;
  }
  root.innerHTML = "";
  for (const tx of state.sessionTxs) {
    const item = document.createElement("details");
    item.className = "tx-item";
    item.innerHTML = `
      <summary>
        <span>${escapeHtml(tx.action)}</span>
        <a href="${escapeHtml(tx.url)}" target="_blank" rel="noreferrer">${escapeHtml(shortHash(tx.hash))}</a>
        <strong>${escapeHtml(tx.status)}</strong>
      </summary>
      <div class="tx-meta">
        <div><span>Chain</span><strong>${escapeHtml(tx.chain)}</strong></div>
        <div><span>Rail</span><strong>${escapeHtml(tx.rail ?? "-")}</strong></div>
        <div><span>Block</span><strong>${escapeHtml(tx.blockNumber ?? "-")}</strong></div>
        <div><span>Gas</span><strong>${escapeHtml(tx.gasUsed ?? "-")}</strong></div>
        <div><span>Note</span><strong>${escapeHtml(tx.note ?? "-")}</strong></div>
      </div>
      <div class="topic-list">${renderTopics(tx.logs ?? [])}</div>
    `;
    root.appendChild(item);
  }
}

function renderTopics(logs) {
  if (!logs.length) return `<span class="topic-empty">No EVM receipt topics.</span>`;
  return logs.map((log) => `
    <div class="topic-row">
      <span>${escapeHtml(log.name)}</span>
      <code>${escapeHtml(shortAddress(log.address))}</code>
      <code>${escapeHtml(log.topic0)}</code>
    </div>
  `).join("");
}

function summarizeLogs(logs) {
  return logs.map((log, index) => {
    const topic0 = log.topics?.[0] ?? "-";
    return {
      index,
      address: log.address,
      topic0,
      name: KNOWN_TOPICS[topic0.toLowerCase()] ?? "Topic",
      topicCount: log.topics?.length ?? 0,
    };
  });
}

async function waitForEvmReceipt(hash) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const receipt = await ethereumRpc("eth_getTransactionReceipt", [hash]);
    if (receipt) return receipt;
    await delay(1_500);
  }
  throw new Error("receipt not available yet");
}

async function ethereumRpc(method, params) {
  if (window.ethereum) {
    return window.ethereum.request({ method, params });
  }
  const response = await fetch(ONCHAIN_CONFIG.chain.rpcUrls[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  return data.result;
}

function loadSessionTxs() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_TX_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function persistSessionTxs() {
  window.localStorage.setItem(SESSION_TX_KEY, JSON.stringify(state.sessionTxs));
}

function clearSessionTxs() {
  state.sessionTxs = [];
  persistSessionTxs();
  renderSessionTxs();
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hexToDecimal(value) {
  if (!value) return "-";
  try {
    return BigInt(value).toString();
  } catch {
    return String(value);
  }
}

async function safeConnectedAccount() {
  if (!window.ethereum) return null;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data;
}

async function solanaRpc(method, params) {
  const response = await fetch(SOLANA_CUSTODY.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  return data.result;
}

function formatBps(value) {
  return `${(Number(value) / 100).toFixed(0)}%`;
}

function shortHash(value) {
  if (!value) return "-";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function shortAddress(value) {
  if (!value) return "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatNav(assets, shares) {
  const assetUnits = BigInt(assets ?? 0);
  const shareUnits = BigInt(shares ?? 0);
  if (shareUnits === 0n) return "1";
  const scaled = (assetUnits * 1_000_000n) / shareUnits;
  return formatUnits(scaled.toString());
}

function decodeCustodyState(encoded) {
  const bytes = base64ToBytes(encoded);
  let offset = 8 + 32 + 32 + 32;
  const readU64 = () => {
    const value = readLittleEndianU64(bytes, offset);
    offset += 8;
    return value;
  };
  const messageCount = readU64();
  const totalReceivedUnits = readU64();
  const totalRedeemUnits = readU64();
  const aaplUnits = readU64();
  const tslaUnits = readU64();
  const nvdaUnits = readU64();
  const lastSourceChainSelector = readU64();
  const lastMessageId = `0x${Array.from(bytes.slice(offset, offset + 32), byteToHex).join("")}`;
  return {
    messageCount: messageCount.toString(),
    totalReceivedUnits: totalReceivedUnits.toString(),
    totalRedeemUnits: totalRedeemUnits.toString(),
    aaplUnits: aaplUnits.toString(),
    tslaUnits: tslaUnits.toString(),
    nvdaUnits: nvdaUnits.toString(),
    lastSourceChainSelector: lastSourceChainSelector.toString(),
    lastMessageId,
  };
}

function base64ToBytes(encoded) {
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readLittleEndianU64(bytes, offset) {
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) {
    value = (value << 8n) + BigInt(bytes[offset + i]);
  }
  return value;
}

function byteToHex(byte) {
  return byte.toString(16).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatKvValue(value) {
  const text = String(value ?? "-");
  if (text.startsWith("<a ")) return text;
  return escapeHtml(text);
}

function linkHtml(label, href) {
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function txLink(tx, label) {
  return linkHtml(label, `https://sepolia.basescan.org/tx/${tx}`);
}

function solanaAccountLink(label, account) {
  return linkHtml(label, `https://explorer.solana.com/address/${account}?cluster=devnet`);
}

function solanaTxLink(label, signature) {
  return linkHtml(label, `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}
