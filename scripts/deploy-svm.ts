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
const PROGRAM_DIR = 'programs/omnietf-portfolio';
const PROGRAM_SO = join(PROGRAM_DIR, 'target', 'deploy', 'omnietf_portfolio.so');
const PROGRAM_KEYPAIR = join(PROGRAM_DIR, 'target', 'deploy', 'omnietf_portfolio-keypair.json');
const PAYER_PATH = 'deployments/solana-payer.json';
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
  if (balance < LAMPORTS_PER_SOL) {
    const sig = await connection.requestAirdrop(payer.publicKey, 5 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, 'confirmed');
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
    rpcUrl: RPC_URL,
    programId: programId.toBase58(),
    state: state.publicKey.toBase58(),
    authority: payer.publicKey.toBase58(),
    payerKeypair: PAYER_PATH,
    stateSecretKey: Array.from(state.secretKey),
    stateSpace: STATE_SPACE,
    note: 'Local solana-test-validator deployment for the trusted-relayer OmniETF demo.',
  };
  await writeFile('deployments/svm-local.json', JSON.stringify(deployment, null, 2) + '\n');
  console.log(`SVM program: ${programId.toBase58()}`);
  console.log(`SVM state: ${state.publicKey.toBase58()}`);
  console.log('Wrote deployments/svm-local.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
