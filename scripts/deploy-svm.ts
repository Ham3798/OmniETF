import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';
const SOLANA_CLUSTER = process.env.SOLANA_CLUSTER ?? (RPC_URL.includes('devnet') ? 'devnet' : 'local');
const PROGRAM_DIR = 'programs/omnietf-portfolio';
const PROGRAM_SO = join(PROGRAM_DIR, 'target', 'deploy', 'omnietf_portfolio.so');
const PROGRAM_KEYPAIR = join(PROGRAM_DIR, 'target', 'deploy', 'omnietf_portfolio-keypair.json');
const PAYER_PATH = process.env.SOLANA_PAYER_KEYPAIR ?? process.env.PAYER_PATH ?? (SOLANA_CLUSTER === 'devnet' ? 'deployments/solana-devnet-payer.json' : 'deployments/solana-payer.json');
const DEPLOYMENT_FILE = process.env.SVM_DEPLOYMENT_FILE ?? process.env.DEPLOYMENT_FILE ?? (SOLANA_CLUSTER === 'devnet' ? 'deployments/svm-devnet.json' : 'deployments/svm-local.json');
const MIN_PAYER_BALANCE_SOL = Number(process.env.MIN_PAYER_BALANCE_SOL ?? (SOLANA_CLUSTER === 'devnet' ? 2 : 1));
const AIRDROP_SOL = Number(process.env.AIRDROP_SOL ?? (SOLANA_CLUSTER === 'devnet' ? 2 : 5));
const STATE_SPACE = 88;

async function readKeypair(path: string): Promise<Keypair> {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(path, 'utf8')) as number[]));
}

async function writeKeypair(path: string, keypair: Keypair) {
  await writeFile(path, JSON.stringify(Array.from(keypair.secretKey)) + '\n');
}

async function ensurePayer(connection: Connection): Promise<Keypair> {
  await mkdir('deployments', { recursive: true });
  const payer = existsSync(PAYER_PATH) ? await readKeypair(PAYER_PATH) : Keypair.generate();
  if (!existsSync(PAYER_PATH)) await writeKeypair(PAYER_PATH, payer);

  const balance = await connection.getBalance(payer.publicKey);
  const minimumBalance = Math.ceil(MIN_PAYER_BALANCE_SOL * LAMPORTS_PER_SOL);
  if (balance < minimumBalance) {
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, Math.ceil(AIRDROP_SOL * LAMPORTS_PER_SOL));
      await connection.confirmTransaction(sig, 'confirmed');
    } catch (error) {
      throw new Error(
        `Payer ${payer.publicKey.toBase58()} has ${balance} lamports; funding via airdrop failed. ` +
          `Fund ${PAYER_PATH} manually or set SOLANA_PAYER_KEYPAIR to a funded keypair. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return payer;
}

async function waitForProgram(connection: Connection, programId: PublicKey) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const info = await connection.getAccountInfo(programId, 'confirmed');
    if (info?.executable) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Program ${programId.toBase58()} was not executable after deploy`);
}

function run(label: string, command: string, args: string[]) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit' });
  console.log(`${label} complete`);
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const payer = await ensurePayer(connection);

  if (process.env.SKIP_SVM_BUILD !== '1') {
    run('SVM build', 'cargo-build-sbf', ['--manifest-path', join(PROGRAM_DIR, 'Cargo.toml')]);
  }

  if (!existsSync(PROGRAM_SO)) throw new Error(`Missing program binary: ${PROGRAM_SO}`);
  if (process.env.PRELOADED_SVM_PROGRAM === '1') {
    console.log('Using program preloaded by solana-test-validator --bpf-program');
  } else {
    run('SVM program deploy', 'solana', [
      'program',
      'deploy',
      PROGRAM_SO,
      '--program-id',
      PROGRAM_KEYPAIR,
      '--keypair',
      PAYER_PATH,
      '--url',
      RPC_URL,
    ]);
  }

  const programKeypair = await readKeypair(PROGRAM_KEYPAIR);
  const programId = programKeypair.publicKey;
  await waitForProgram(connection, programId);
  const state = Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(STATE_SPACE);
  const createState = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: state.publicKey,
    lamports,
    space: STATE_SPACE,
    programId,
  });
  const initialize = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: state.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([0]),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(createState, initialize), [payer, state]);

  const deployment = {
    cluster: SOLANA_CLUSTER,
    rpcUrl: RPC_URL,
    programId: programId.toBase58(),
    state: state.publicKey.toBase58(),
    authority: payer.publicKey.toBase58(),
    payerKeypair: PAYER_PATH,
    stateSecretKey: Array.from(state.secretKey),
    stateSpace: STATE_SPACE,
    note: SOLANA_CLUSTER === 'devnet'
      ? 'Solana Devnet deployment for the OmniETF trusted-relayer testnet PoC. Private state key is local-only; do not commit generated deployment files.'
      : 'Local solana-test-validator deployment for the trusted-relayer OmniETF demo.',
  };
  await writeFile(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2) + '\n');
  console.log(`SVM program: ${programId.toBase58()}`);
  console.log(`SVM state: ${state.publicKey.toBase58()}`);
  console.log(`Wrote ${DEPLOYMENT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
