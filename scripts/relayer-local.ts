import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createPublicClient, createWalletClient, http, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import localDeployment from '../deployments/local.json' assert { type: 'json' };
import svmDeployment from '../deployments/svm-local.json' assert { type: 'json' };
import bridgeArtifact from '../contracts/out/LocalSvmBridgeAdapter.sol/LocalSvmBridgeAdapter.json' assert { type: 'json' };

const PORT = Number(process.env.RELAYER_PORT ?? 8787);
const SCALE_TO_WAD = 10n ** 12n;

type SvmState = {
  aaplx: bigint;
  tslax: bigint;
  nvdax: bigint;
  total: bigint;
  lastRequestId: bigint;
  lastAction: bigint;
};

type Message = {
  amount: bigint;
  shares: bigint;
  messageType: number;
  status: number;
};

const account = privateKeyToAccount(localDeployment.demoPrivateKey as `0x${string}`);
const publicClient = createPublicClient({ chain: foundry, transport: http(localDeployment.rpcUrl) });
const walletClient = createWalletClient({ account, chain: foundry, transport: http(localDeployment.rpcUrl) });
const bridge = {
  address: (localDeployment.contracts.LocalSvmBridgeAdapter ?? localDeployment.contracts.MockBridgeAdapter) as `0x${string}`,
  abi: bridgeArtifact.abi as Abi,
};
const connection = new Connection(svmDeployment.rpcUrl, 'confirmed');
const programId = new PublicKey(svmDeployment.programId);
const statePubkey = new PublicKey(svmDeployment.state);
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(svmDeployment.payerKeypair, 'utf8')) as number[]));

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function instruction(tag: number, requestId = 0n, amount = 0n): TransactionInstruction {
  const data = tag === 0 ? Buffer.from([0]) : Buffer.concat([Buffer.from([tag]), u64(requestId), u64(amount)]);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: statePubkey, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function sendSvm(ix: TransactionInstruction) {
  return sendAndConfirmTransaction(connection, new Transaction().add(ix), [authority]);
}

async function readSvmState(): Promise<SvmState> {
  const accountInfo = await connection.getAccountInfo(statePubkey, 'confirmed');
  if (!accountInfo) throw new Error(`Missing SVM state account ${statePubkey.toBase58()}`);
  const data = accountInfo.data;
  return {
    aaplx: data.readBigUInt64LE(40),
    tslax: data.readBigUInt64LE(48),
    nvdax: data.readBigUInt64LE(56),
    total: data.readBigUInt64LE(64),
    lastRequestId: data.readBigUInt64LE(72),
    lastAction: data.readBigUInt64LE(80),
  };
}

function snapshot(state: SvmState) {
  return {
    aaplxAmount: state.aaplx * SCALE_TO_WAD,
    tslaxAmount: state.tslax * SCALE_TO_WAD,
    nvdaxAmount: state.nvdax * SCALE_TO_WAD,
    totalValueUsdc: state.total,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  };
}

async function readMessage(requestId: bigint): Promise<Message> {
  const raw = (await publicClient.readContract({ ...bridge, functionName: 'messages', args: [requestId] })) as any;
  return {
    amount: BigInt(raw.amount ?? raw[2]),
    shares: BigInt(raw.shares ?? raw[3]),
    messageType: Number(raw.messageType ?? raw[4]),
    status: Number(raw.status ?? raw[5]),
  };
}

async function ack(functionName: 'ackAllocation' | 'ackRedeem' | 'ackRebalance', args: readonly unknown[]) {
  const hash = await walletClient.writeContract({ ...bridge, functionName, args });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

async function relay(kind: string, requestIdText: string) {
  const requestId = BigInt(requestIdText);
  const message = await readMessage(requestId);
  if (message.status !== 1) throw new Error(`Request #${requestId} is not Sent; status=${message.status}`);

  if (kind === 'allocation') {
    if (message.messageType !== 1) throw new Error(`Request #${requestId} is not Allocation`);
    await sendSvm(instruction(1, requestId, message.amount));
    const state = await readSvmState();
    const hash = await ack('ackAllocation', [requestId, snapshot(state)]);
    return { requestId: requestId.toString(), kind, evmTx: hash, svm: stringifyState(state) };
  }

  if (kind === 'redeem') {
    if (message.messageType !== 2) throw new Error(`Request #${requestId} is not Redeem`);
    await sendSvm(instruction(2, requestId, message.amount));
    const state = await readSvmState();
    const hash = await ack('ackRedeem', [requestId, message.amount, snapshot(state)]);
    return { requestId: requestId.toString(), kind, returnedUsdc: message.amount.toString(), evmTx: hash, svm: stringifyState(state) };
  }

  if (kind === 'rebalance') {
    if (message.messageType !== 3) throw new Error(`Request #${requestId} is not Rebalance`);
    await sendSvm(instruction(3, requestId));
    const state = await readSvmState();
    const hash = await ack('ackRebalance', [requestId, snapshot(state)]);
    return { requestId: requestId.toString(), kind, evmTx: hash, svm: stringifyState(state) };
  }

  throw new Error(`Unknown relay kind: ${kind}`);
}

function stringifyState(state: SvmState) {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value.toString()]));
}

async function handle(url: URL) {
  if (url.pathname === '/health') return { ok: true, mode: 'local-svm-relayer' };
  if (url.pathname === '/state') return { ok: true, svm: stringifyState(await readSvmState()) };
  const match = url.pathname.match(/^\/relay\/(allocation|redeem|rebalance)\/(\d+)$/);
  if (match) return { ok: true, result: await relay(match[1], match[2]) };
  return { ok: false, error: 'not found' };
}

if (process.argv[2] === '--once') {
  const [, , , kind, requestId] = process.argv;
  if (!kind || !requestId) throw new Error('Usage: tsx scripts/relayer-local.ts --once <allocation|redeem|rebalance> <requestId>');
  console.log(JSON.stringify(await relay(kind, requestId), null, 2));
} else {
  createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    try {
      const body = await handle(new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`));
      res.writeHead(body.ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }).listen(PORT, '127.0.0.1', () => {
    console.log(`Local EVM↔SVM relayer listening on http://127.0.0.1:${PORT}`);
  });
}
