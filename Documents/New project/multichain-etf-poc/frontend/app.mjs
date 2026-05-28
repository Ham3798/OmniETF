import { createDefaultSystem, formatUsd } from "../shared/js/poc-core.mjs";
import { portfolioConfig } from "../shared/js/portfolio-config.mjs";
import { mountLiveBaseDemo } from "./base-live.mjs";

let system = createDefaultSystem();

const elements = {
  queueBadge: document.querySelector("#queue-badge"),
  sharePrice: document.querySelector("#share-price"),
  totalShares: document.querySelector("#total-shares"),
  activeNav: document.querySelector("#active-nav"),
  reservedNav: document.querySelector("#reserved-nav"),
  solanaNav: document.querySelector("#solana-nav"),
  positionsBody: document.querySelector("#positions-body"),
  timeline: document.querySelector("#timeline"),
  marketGrid: document.querySelector("#market-grid"),
  redeemShares: document.querySelector("#redeem-shares"),
  seedDeposit: document.querySelector("#seed-deposit"),
  bridgeNow: document.querySelector("#bridge-now"),
  queueRedeem: document.querySelector("#queue-redeem"),
  resetState: document.querySelector("#reset-state"),
  scenarioButtons: [...document.querySelectorAll(".scenario")]
};

function render() {
  const snapshot = system.relayer.snapshot();
  const { vault, executor, queue, timeline } = snapshot;

  elements.queueBadge.textContent = `Queue ${queue.length}`;
  elements.sharePrice.textContent = `${vault.sharePrice.toFixed(4)} USDC`;
  elements.totalShares.textContent = vault.totalShares.toFixed(2);
  elements.activeNav.textContent = formatUsd(vault.activeAssets);
  elements.reservedNav.textContent = formatUsd(vault.reservedRedemptionAssets);
  elements.solanaNav.textContent = formatUsd(executor.nav);

  elements.positionsBody.innerHTML = executor.positions.map((position, index) => `
    <tr>
      <td>${position.symbol}</td>
      <td>${(portfolioConfig.weights[index].weightBps / 100).toFixed(0)}%</td>
      <td>${position.price.toFixed(2)}</td>
      <td>${position.units.toFixed(2)}</td>
      <td>${formatUsd(position.value)}</td>
    </tr>
  `).join("");

  elements.marketGrid.innerHTML = executor.positions.map((position) => `
    <div class="market-card">
      <span>${position.symbol}</span>
      <strong>${position.price.toFixed(2)}</strong>
    </div>
  `).join("");

  elements.timeline.innerHTML = timeline.length > 0
    ? timeline.map((entry) => `
        <article class="timeline-item">
          <time>${new Date(entry.at).toLocaleTimeString("ko-KR")}</time>
          <div>${entry.message}</div>
        </article>
      `).join("")
    : `<article class="timeline-item"><div>Queue에 작업을 넣으면 relayer 이벤트가 여기에 표시됩니다.</div></article>`;
}

function queueDeposit() {
  system.relayer.queueDeposit(1000);
  render();
}

function processNext() {
  system.relayer.processNext();
  render();
}

function queueScenario(key) {
  system.relayer.queuePriceScenario(portfolioConfig.marketScenarios[key], key);
  render();
}

function queueRedeem() {
  const shares = Number(elements.redeemShares.value);

  if (!Number.isFinite(shares) || shares <= 0) {
    return;
  }

  system.relayer.queueRedeem(shares);
  render();
}

function reset() {
  system = createDefaultSystem();
  render();
}

elements.seedDeposit.addEventListener("click", queueDeposit);
elements.bridgeNow.addEventListener("click", processNext);
elements.queueRedeem.addEventListener("click", queueRedeem);
elements.resetState.addEventListener("click", reset);
elements.scenarioButtons.forEach((button) => {
  button.addEventListener("click", () => {
    queueScenario(button.dataset.scenario);
  });
});

render();
mountLiveBaseDemo();
