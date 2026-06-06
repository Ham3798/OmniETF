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
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, foundry } from 'viem/chains';
import bridgeArtifact from '../contracts/out/LocalSvmBridgeAdapter.sol/LocalSvmBridgeAdapter.json' assert { type: 'json' };

const PORT = Number(process.env.RELAYER_PORT ?? 8787);
const SCALE_TO_WAD = 10n ** 12n;
const EVM_DEPLOYMENT_FILE = process.env.EVM_DEPLOYMENT_FILE ?? 'deployments/local.json';
const SVM_DEPLOYMENT_FILE = process.env.SVM_DEPLOYMENT_FILE ?? 'deployments/svm-local.json';

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

type EvmDeployment = {
  chainName?: string;
  chainId: number;
  rpcUrl: string;
  demoPrivateKey?: `0x${string}`;
  contracts: {
    LocalSvmBridgeAdapter?: string;
    MockBridgeAdapter?: string;
    bridge?: string;
  };
};

type SvmDeployment = {
  rpcUrl: string;
  programId: string;
  state: string;
  payerKeypair: string;
};

const localDeployment = JSON.parse(await readFile(EVM_DEPLOYMENT_FILE, 'utf8')) as EvmDeployment;
const svmDeployment = JSON.parse(await readFile(SVM_DEPLOYMENT_FILE, 'utf8')) as SvmDeployment;

function chainFor(chainId: number): Chain {
  if (chainId === foundry.id) return foundry;
  if (chainId === baseSepolia.id) return baseSepolia;
  return defineChain({
    id: chainId,
    name: localDeployment.chainName ?? `chain-${chainId}`,
    nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
    rpcUrls: { default: { http: [localDeployment.rpcUrl] } },
  });
}

function relayerPrivateKey(): `0x${string}` | undefined {
  return localDeployment.demoPrivateKey ?? (process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined);
}

const privateKey = relayerPrivateKey();
const account = privateKey ? privateKeyToAccount(privateKey) : null;
const chain = chainFor(localDeployment.chainId);
const publicClient = createPublicClient({ chain, transport: http(localDeployment.rpcUrl) });
const walletClient = account ? createWalletClient({ account, chain, transport: http(localDeployment.rpcUrl) }) : null;
const bridge = {
  address: (localDeployment.contracts.LocalSvmBridgeAdapter ?? localDeployment.contracts.bridge ?? localDeployment.contracts.MockBridgeAdapter) as `0x${string}`,
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
  if (!walletClient) {
    throw new Error(`DEPLOYER_PRIVATE_KEY is required to relay/ack EVM transactions for ${EVM_DEPLOYMENT_FILE}. /state remains available without it.`);
  }
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
    const svmTx = await sendSvm(instruction(1, requestId, message.amount));
    const state = await readSvmState();
    const evmTx = await ack('ackAllocation', [requestId, snapshot(state)]);
    return { requestId: requestId.toString(), kind, evmTx, svmTx, svm: stringifyState(state) };
  }

  if (kind === 'redeem') {
    if (message.messageType !== 2) throw new Error(`Request #${requestId} is not Redeem`);
    const svmTx = await sendSvm(instruction(2, requestId, message.amount));
    const state = await readSvmState();
    const evmTx = await ack('ackRedeem', [requestId, message.amount, snapshot(state)]);
    return { requestId: requestId.toString(), kind, returnedUsdc: message.amount.toString(), evmTx, svmTx, svm: stringifyState(state) };
  }

  if (kind === 'rebalance') {
    if (message.messageType !== 3) throw new Error(`Request #${requestId} is not Rebalance`);
    const svmTx = await sendSvm(instruction(3, requestId));
    const state = await readSvmState();
    const evmTx = await ack('ackRebalance', [requestId, snapshot(state)]);
    return { requestId: requestId.toString(), kind, evmTx, svmTx, svm: stringifyState(state) };
  }

  throw new Error(`Unknown relay kind: ${kind}`);
}

function stringifyState(state: SvmState) {
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value.toString()]));
}

async function handle(url: URL) {
  if (url.pathname === '/health') {
    return { ok: true, mode: 'evm-svm-relayer', canRelay: Boolean(walletClient), evmDeployment: EVM_DEPLOYMENT_FILE, svmDeployment: SVM_DEPLOYMENT_FILE };
  }
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
    console.log(`EVM↔SVM relayer listening on http://127.0.0.1:${PORT}`);
  });
}
