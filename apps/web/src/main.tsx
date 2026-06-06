import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseUnits, type Abi } from 'viem';
import {
  CHAIN_LABEL,
  DEMO_MODE,
  DEMO_USER,
  EXPECTED_CHAIN_ID,
  READ_ONLY,
  RELAYER_URL,
  assetIds,
  contracts,
  evmTxUrl,
  nav,
  parseShares,
  parseUsdc,
  publicClient,
  shares,
  synthetic,
  usdc,
  solanaTxUrl,
  wait,
  walletClient,
} from './contracts';
import './styles.css';

type Snapshot = {
  userUsdc: bigint;
  shareBalance: bigint;
  totalSupply: bigint;
  navPerShare: bigint;
  portfolioValue: bigint;
  claimable: bigint;
  nextRequestId: bigint;
  bridgeUsdc: bigint;
  managerUsdc: bigint;
  aaplx: bigint;
  tslax: bigint;
  nvdax: bigint;
  remoteLastRequestId: bigint;
  remoteLastAction: bigint;
  chainOk: boolean;
  relayerOk: boolean;
  remoteSource: 'SVM program' | 'EVM mock';
};

type StepState = 'idle' | 'active' | 'done';

type DoneState = {
  approved: boolean;
  depositRequested: boolean;
  allocationExecuted: boolean;
  allocationAcked: boolean;
  rebalanced: boolean;
  redeemRequested: boolean;
  redeemExecuted: boolean;
  redeemAcked: boolean;
  claimed: boolean;
};

const initialDone: DoneState = {
  approved: false,
  depositRequested: false,
  allocationExecuted: false,
  allocationAcked: false,
  rebalanced: false,
  redeemRequested: false,
  redeemExecuted: false,
  redeemAcked: false,
  claimed: false,
};

const initialSnapshot: Snapshot = {
  userUsdc: 0n,
  shareBalance: 0n,
  totalSupply: 0n,
  navPerShare: 0n,
  portfolioValue: 0n,
  claimable: 0n,
  nextRequestId: 0n,
  bridgeUsdc: 0n,
  managerUsdc: 0n,
  aaplx: 0n,
  tslax: 0n,
  nvdax: 0n,
  remoteLastRequestId: 0n,
  remoteLastAction: 0n,
  chainOk: false,
  relayerOk: false,
  remoteSource: DEMO_MODE === 'svm' ? 'SVM program' : 'EVM mock',
};

const timeline = [
  { zone: 'EVM', title: 'Approve USDC', detail: '사용자가 ETF Manager에 USDC 사용 권한을 줍니다.' },
  { zone: 'EVM', title: 'Request Deposit', detail: 'USDC가 bridge escrow에 lock되고 allocation intent가 생성됩니다.' },
  { zone: 'Bridge', title: 'Relay Deposit Intent', detail: '로컬 relayer/bridge가 SVM 포트폴리오 실행을 시작합니다.' },
  { zone: 'SVM', title: 'Allocate / Swap Basket', detail: 'SVM program이 AAPLx/TSLAx/NVDAx synthetic basket으로 분배합니다.' },
  { zone: 'EVM', title: 'Ack + Mint mETF', detail: 'SVM snapshot을 확인한 뒤 EVM에서 mETF를 mint합니다.' },
  { zone: 'SVM', title: 'Rebalance / NAV Sync', detail: '원격 reserve snapshot을 갱신해 EVM NAV에 반영합니다.' },
  { zone: 'EVM', title: 'Request Redeem / Burn mETF', detail: '유저 mETF를 burn하고 SVM sell intent를 보냅니다.' },
  { zone: 'SVM', title: 'Sell / Burn Basket', detail: 'SVM synthetic basket을 비례 소각/매도합니다.' },
  { zone: 'Bridge', title: 'Ack Return Funds', detail: '반환 USDC와 새 snapshot을 EVM에 ack합니다.' },
  { zone: 'EVM', title: 'Claim USDC', detail: '유저가 claimable USDC를 수령합니다.' },
];

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [depositAmount, setDepositAmount] = useState('100');
  const [redeemAmount, setRedeemAmount] = useState('50');
  const [depositId, setDepositId] = useState<bigint | null>(null);
  const [rebalanceId, setRebalanceId] = useState<bigint | null>(null);
  const [redeemId, setRedeemId] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState<DoneState>(initialDone);

  const effectiveDone = useMemo(() => READ_ONLY ? deriveDone(snapshot, done) : done, [snapshot, done]);
  const stepStates = useMemo(() => computeSteps(effectiveDone), [effectiveDone]);
  const isSvmMode = DEMO_MODE === 'svm';

  async function refresh() {
    const [chainId, userUsdc, shareBalance, totalSupply, navPerShare, portfolioValue, claimable, nextRequestId, bridgeUsdc, managerUsdc] = await Promise.all([
      publicClient.getChainId(),
      publicClient.readContract({ ...contracts.usdc, functionName: 'balanceOf', args: [DEMO_USER] }),
      publicClient.readContract({ ...contracts.share, functionName: 'balanceOf', args: [DEMO_USER] }),
      publicClient.readContract({ ...contracts.share, functionName: 'totalSupply' }),
      publicClient.readContract({ ...contracts.manager, functionName: 'navPerShare' }),
      publicClient.readContract({ ...contracts.manager, functionName: 'totalPortfolioValueUsdc' }),
      publicClient.readContract({ ...contracts.manager, functionName: 'totalClaimableUsdc' }),
      publicClient.readContract({ ...contracts.manager, functionName: 'nextRequestId' }),
      publicClient.readContract({ ...contracts.usdc, functionName: 'balanceOf', args: [contracts.bridge.address] }),
      publicClient.readContract({ ...contracts.usdc, functionName: 'balanceOf', args: [contracts.manager.address] }),
    ]);

    const remote = await readRemoteState();
    setSnapshot({
      userUsdc: userUsdc as bigint,
      shareBalance: shareBalance as bigint,
      totalSupply: totalSupply as bigint,
      navPerShare: navPerShare as bigint,
      portfolioValue: portfolioValue as bigint,
      claimable: claimable as bigint,
      nextRequestId: nextRequestId as bigint,
      bridgeUsdc: bridgeUsdc as bigint,
      managerUsdc: managerUsdc as bigint,
      aaplx: remote.aaplx,
      tslax: remote.tslax,
      nvdax: remote.nvdax,
      remoteLastRequestId: remote.lastRequestId,
      remoteLastAction: remote.lastAction,
      chainOk: chainId === EXPECTED_CHAIN_ID,
      relayerOk: remote.relayerOk,
      remoteSource: remote.source,
    });
  }

  async function readRemoteState(): Promise<{ aaplx: bigint; tslax: bigint; nvdax: bigint; lastRequestId: bigint; lastAction: bigint; relayerOk: boolean; source: Snapshot['remoteSource'] }> {
    if (isSvmMode) {
      try {
        const response = await fetch(`${RELAYER_URL}/state`);
        const body = await response.json();
        if (!body.ok) throw new Error(body.error ?? 'relayer state failed');
        return {
          aaplx: BigInt(body.svm.aaplx),
          tslax: BigInt(body.svm.tslax),
          nvdax: BigInt(body.svm.nvdax),
          lastRequestId: BigInt(body.svm.lastRequestId ?? 0),
          lastAction: BigInt(body.svm.lastAction ?? 0),
          relayerOk: true,
          source: 'SVM program',
        };
      } catch {
        return { aaplx: 0n, tslax: 0n, nvdax: 0n, lastRequestId: 0n, lastAction: 0n, relayerOk: false, source: 'SVM program' };
      }
    }

    if (!contracts.portfolio) return { aaplx: 0n, tslax: 0n, nvdax: 0n, lastRequestId: 0n, lastAction: 0n, relayerOk: false, source: 'EVM mock' };
    const [aaplx, tslax, nvdax] = await Promise.all([
      publicClient.readContract({ ...contracts.portfolio, functionName: 'aaplxBalance' }),
      publicClient.readContract({ ...contracts.portfolio, functionName: 'tslaxBalance' }),
      publicClient.readContract({ ...contracts.portfolio, functionName: 'nvdaxBalance' }),
    ]);
    return { aaplx: aaplx as bigint, tslax: tslax as bigint, nvdax: nvdax as bigint, lastRequestId: 0n, lastAction: 0n, relayerOk: true, source: 'EVM mock' };
  }

  useEffect(() => {
    refresh().catch((error) => addLog(`Refresh failed: ${String(error)}`));
    const timer = window.setInterval(() => refresh().catch(() => undefined), 4_000);
    return () => window.clearInterval(timer);
  }, []);

  function addLog(message: string) {
    const time = new Date().toLocaleTimeString();
    setLog((old) => [`${time} — ${message}`, ...old].slice(0, 14));
  }

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    try {
      await action();
      addLog(`${label} complete`);
      await refresh();
    } catch (error) {
      console.error(error);
      addLog(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function tx(address: `0x${string}`, abi: Abi, functionName: string, args: readonly unknown[] = []) {
    if (!walletClient) throw new Error('Read-only testnet UI: private-key signing is disabled. Use scripts/CLI for mutating EVM transactions.');
    const hash = await (walletClient as any).writeContract({ address, abi, functionName, args });
    await wait(hash);
    return hash;
  }

  async function relay(kind: 'allocation' | 'redeem' | 'rebalance', requestId: bigint) {
    if (isSvmMode) {
      const response = await fetch(`${RELAYER_URL}/relay/${kind}/${requestId.toString()}`, { method: 'POST' });
      const body = await response.json();
      if (!body.ok) throw new Error(body.error ?? 'local relayer failed');
      return body;
    }

    if (kind === 'allocation') {
      await tx(contracts.bridge.address, contracts.bridge.abi, 'executeAllocation', [requestId]);
      setDone((old) => ({ ...old, allocationExecuted: true }));
      await tx(contracts.bridge.address, contracts.bridge.abi, 'ackAllocation', [requestId]);
      return;
    }
    if (kind === 'redeem') {
      await tx(contracts.bridge.address, contracts.bridge.abi, 'executeRedeem', [requestId]);
      setDone((old) => ({ ...old, redeemExecuted: true }));
      await tx(contracts.bridge.address, contracts.bridge.abi, 'ackRedeem', [requestId]);
      return;
    }
    await tx(contracts.bridge.address, contracts.bridge.abi, 'executeRebalance', [requestId]);
    await tx(contracts.bridge.address, contracts.bridge.abi, 'ackRebalance', [requestId]);
  }

  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">{CHAIN_LABEL} {isSvmMode ? 'EVM ↔ SVM' : 'Mock'} PoC</p>
          <h1>OmniETF Cross-Chain Flow</h1>
          <p className="subtitle">EVM에서 USDC를 lock하고, bridge/relayer를 통해 SVM basket allocation을 실행한 뒤, snapshot ack 후 mETF를 mint/redeem합니다.</p>
        </div>
        <div className="status-stack">
          <div className={snapshot.chainOk ? 'badge ok' : 'badge warn'}>{snapshot.chainOk ? `${CHAIN_LABEL} connected` : `Check ${CHAIN_LABEL} RPC`}</div>
          <div className={snapshot.relayerOk ? 'badge ok' : 'badge warn'}>{snapshot.remoteSource}{isSvmMode && !snapshot.relayerOk ? ' / relayer offline' : ' online'}</div>
          {READ_ONLY ? <div className="badge warn">read-only UI</div> : <div className="badge ok">signing enabled</div>}
        </div>
      </section>

      <section className="panel">
        <h2>Deployment</h2>
        <div className="address-grid">
          <Address label="Manager" value={contracts.manager.address} />
          <Address label="Share" value={contracts.share.address} />
          <Address label="MockUSDC" value={contracts.usdc.address} />
          <Address label="Bridge" value={contracts.bridge.address} />
        </div>
        <p className="hint">{READ_ONLY ? '테스트넷 UI는 현재 조회 중심입니다. Base 트랜잭션 생성은 CLI 또는 별도 지갑 연동으로 실행하고, relayer 서버가 켜져 있으면 SVM 상태를 함께 조회합니다.' : 'Signing is enabled for this deployment.'}</p>
      </section>

      <section className="grid metrics">
        <Metric label="User USDC" value={usdc(snapshot.userUsdc)} />
        <Metric label="mETF Balance" value={shares(snapshot.shareBalance)} />
        <Metric label="NAV / Share" value={nav(snapshot.navPerShare)} />
        <Metric label="Acked Remote Reserve" value={usdc(snapshot.portfolioValue)} />
        <Metric label="Bridge Escrow" value={usdc(snapshot.bridgeUsdc)} />
        <Metric label="Claimable" value={usdc(snapshot.claimable)} />
        <Metric label="SVM Last Action" value={snapshot.remoteLastAction === 1n ? 'Allocate' : snapshot.remoteLastAction === 2n ? 'Redeem' : snapshot.remoteLastAction === 3n ? 'Rebalance' : 'None'} />
      </section>

      <section className="panel">
        <div className="section-title">
          <div>
            <h2>Retail-visible lifecycle</h2>
            <p className="hint">각 카드가 사용자가 보는 상태와 실제 실행 위치를 함께 보여줍니다.</p>
          </div>
          <button className="secondary" onClick={() => refresh()} disabled={busy !== null}>Refresh</button>
        </div>
        <div className="flow-grid">
          {timeline.map((step, index) => (
            <div key={step.title} className={`flow-card ${stepStates[index]}`}>
              <div className="flow-top"><span>{index + 1}</span><code>{step.zone}</code></div>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid two">
        <div className="panel lane deposit-lane">
          <p className="eyebrow">Deposit / Mint lane</p>
          <h2>EVM USDC → Bridge → SVM Allocation → EVM mETF Mint</h2>
          <label>
            Deposit amount USDC
            <input value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} />
          </label>
          <div className="button-row">
            <Action label="1. EVM Approve USDC" busy={busy} disabled={READ_ONLY} onClick={() => run('Approve USDC', () => tx(contracts.usdc.address, contracts.usdc.abi, 'approve', [contracts.manager.address, parseUsdc(depositAmount)]).then(() => setDone((old) => ({ ...old, approved: true }))))} />
            <Action
              label="2. EVM Request Deposit / Lock"
              busy={busy}
              disabled={READ_ONLY}
              onClick={() =>
                run('Request Deposit', async () => {
                  const next = (await publicClient.readContract({ ...contracts.manager, functionName: 'nextRequestId' })) as bigint;
                  await tx(contracts.manager.address, contracts.manager.abi, 'requestDeposit', [parseUsdc(depositAmount)]);
                  setDepositId(next);
                  setDone((old) => ({ ...old, depositRequested: true }));
                })
              }
            />
            <Action
              label={isSvmMode ? '3-5. Relay → SVM Swap → Ack Mint' : '3-5. Mock Execute → Ack Mint'}
              busy={busy}
              disabled={depositId === null}
              onClick={() => run('Relay Allocation', async () => {
                await relay('allocation', depositId!);
                setDone((old) => ({ ...old, allocationExecuted: true, allocationAcked: true }));
              })}
            />
          </div>
          <p className="hint">Deposit request id: {depositId ? `#${depositId.toString()}` : 'not requested'} · mETF는 SVM/remote ack 이후에만 mint됩니다.</p>
        </div>

        <div className="panel lane svm-lane">
          <p className="eyebrow">Remote SVM basket</p>
          <h2>Received funds allocation / synthetic swap</h2>
          <div className="bars">
            <Bar label="AAPLx" amount={snapshot.aaplx} target="40%" svm={isSvmMode} />
            <Bar label="TSLAx" amount={snapshot.tslax} target="30%" svm={isSvmMode} />
            <Bar label="NVDAx" amount={snapshot.nvdax} target="30%" svm={isSvmMode} />
          </div>
          <p className="hint">{isSvmMode ? '이 값은 solana-test-validator의 SVM program state에서 relayer가 읽습니다.' : '현재 mock mode에서는 Solidity MockSolanaPortfolio에서 읽습니다.'}</p>
        </div>
      </section>

      <section className="grid two">
        <div className="panel lane rebalance-lane">
          <p className="eyebrow">NAV sync</p>
          <h2>SVM snapshot → EVM NAV update</h2>
          <p className="hint">Rebalance intent를 만들고 remote basket snapshot을 EVM Manager에 ack합니다.</p>
          <Action
            label="Run Rebalance / NAV Sync"
            busy={busy}
            disabled={READ_ONLY || !done.allocationAcked}
            onClick={() =>
              run('Rebalance / NAV Sync', async () => {
                if (!isSvmMode) {
                  await tx(contracts.oracle.address, contracts.oracle.abi, 'setPrice', [assetIds.AAPLX, parseUnits('200', 18)]);
                }
                const next = (await publicClient.readContract({ ...contracts.manager, functionName: 'nextRequestId' })) as bigint;
                await tx(contracts.manager.address, contracts.manager.abi, 'requestRebalance');
                setRebalanceId(next);
                await relay('rebalance', next);
                setDone((old) => ({ ...old, rebalanced: true }));
              })
            }
          />
          <p className="hint">Rebalance request id: {rebalanceId ? `#${rebalanceId.toString()}` : 'not requested'}</p>
        </div>

        <div className="panel lane redeem-lane">
          <p className="eyebrow">Redeem / burn lane</p>
          <h2>EVM mETF Burn → SVM Basket Sell/Burn → Bridge Return → Claim</h2>
          <label>
            Redeem amount mETF
            <input value={redeemAmount} onChange={(event) => setRedeemAmount(event.target.value)} />
          </label>
          <div className="button-row">
            <Action
              label="6. EVM Request Redeem / Burn"
              busy={busy}
              disabled={READ_ONLY || !done.allocationAcked}
              onClick={() =>
                run('Request Redeem', async () => {
                  const next = (await publicClient.readContract({ ...contracts.manager, functionName: 'nextRequestId' })) as bigint;
                  await tx(contracts.manager.address, contracts.manager.abi, 'requestRedeem', [parseShares(redeemAmount)]);
                  setRedeemId(next);
                  setDone((old) => ({ ...old, redeemRequested: true }));
                })
              }
            />
            <Action
              label={isSvmMode ? '7-9. Relay → SVM Sell/Burn → Ack Return' : '7-9. Mock Sell → Ack Return'}
              busy={busy}
              disabled={redeemId === null}
              onClick={() => run('Relay Redeem', async () => {
                await relay('redeem', redeemId!);
                setDone((old) => ({ ...old, redeemExecuted: true, redeemAcked: true }));
              })}
            />
            <Action label="10. EVM Claim USDC" busy={busy} disabled={READ_ONLY || redeemId === null || !done.redeemAcked} onClick={() => run('Claim USDC', () => tx(contracts.manager.address, contracts.manager.abi, 'claimRedeem', [redeemId]).then(() => setDone((old) => ({ ...old, claimed: true }))))} />
          </div>
          <p className="hint">Redeem request id: {redeemId ? `#${redeemId.toString()}` : 'not requested'} · Request 시 mETF가 먼저 burn되고, remote sell ack 후 USDC가 claimable이 됩니다.</p>
        </div>
      </section>

      <section className="panel log-panel">
        <h2>Run Log</h2>
        <ul>{log.length === 0 ? <li>No actions yet.</li> : log.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><p>{label}</p><strong>{value}</strong></div>;
}

function Address({ label, value }: { label: string; value: string }) {
  const evmBase = evmTxUrl('');
  const href = value.startsWith('0x') && evmBase ? `${evmBase.replace('/tx/', '/address/')}${value}` : value.startsWith('0x') ? undefined : solanaTxUrl(value);
  return <div className="address-card"><p>{label}</p>{href ? <a href={href} target="_blank" rel="noreferrer">{value}</a> : <code>{value}</code>}</div>;
}

function Action({ label, busy, disabled, onClick }: { label: string; busy: string | null; disabled?: boolean; onClick: () => void }) {
  return <button onClick={onClick} disabled={Boolean(busy) || disabled}>{busy === label ? 'Working...' : label}</button>;
}

function Bar({ label, amount, target, svm }: { label: string; amount: bigint; target: string; svm: boolean }) {
  return (
    <div className="bar-row">
      <div><strong>{label}</strong><span>target {target}</span></div>
      <code>{svm ? synthetic(amount) : `${Number(amount) / 1e18}`}</code>
    </div>
  );
}

function deriveDone(snapshot: Snapshot, current: DoneState): DoneState {
  const hasRemotePortfolio = snapshot.portfolioValue > 0n || snapshot.remoteLastAction > 0n;
  const hasRedeemed = snapshot.remoteLastAction === 2n;
  return {
    approved: current.approved || snapshot.nextRequestId > 1n || hasRemotePortfolio,
    depositRequested: current.depositRequested || snapshot.nextRequestId > 1n || hasRemotePortfolio,
    allocationExecuted: current.allocationExecuted || hasRemotePortfolio,
    allocationAcked: current.allocationAcked || snapshot.portfolioValue > 0n || snapshot.shareBalance > 0n,
    rebalanced: current.rebalanced || snapshot.remoteLastAction === 3n || snapshot.remoteLastRequestId >= 2n,
    redeemRequested: current.redeemRequested || hasRedeemed,
    redeemExecuted: current.redeemExecuted || hasRedeemed,
    redeemAcked: current.redeemAcked || hasRedeemed,
    claimed: current.claimed || (hasRedeemed && snapshot.claimable === 0n),
  };
}

function computeSteps(done: DoneState): StepState[] {
  return [
    done.approved ? 'done' : 'active',
    done.depositRequested ? 'done' : done.approved ? 'active' : 'idle',
    done.depositRequested ? (done.allocationExecuted ? 'done' : 'active') : 'idle',
    done.allocationExecuted ? 'done' : 'idle',
    done.allocationAcked ? 'done' : done.allocationExecuted ? 'active' : 'idle',
    done.rebalanced ? 'done' : done.allocationAcked ? 'active' : 'idle',
    done.redeemRequested ? 'done' : done.allocationAcked ? 'active' : 'idle',
    done.redeemExecuted ? 'done' : done.redeemRequested ? 'active' : 'idle',
    done.redeemAcked ? 'done' : done.redeemExecuted ? 'active' : 'idle',
    done.claimed ? 'done' : done.redeemAcked ? 'active' : 'idle',
  ];
}

createRoot(document.getElementById('root')!).render(<App />);
