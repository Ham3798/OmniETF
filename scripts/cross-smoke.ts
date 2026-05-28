import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, parseUnits, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import deployment from '../deployments/local.json' assert { type: 'json' };
import svmDeployment from '../deployments/svm-local.json' assert { type: 'json' };
import managerArtifact from '../contracts/out/OmniETFManager.sol/OmniETFManager.json' assert { type: 'json' };
import shareArtifact from '../contracts/out/OmniETFShare.sol/OmniETFShare.json' assert { type: 'json' };
import usdcArtifact from '../contracts/out/MockUSDC.sol/MockUSDC.json' assert { type: 'json' };

const account = privateKeyToAccount(deployment.demoPrivateKey as `0x${string}`);
const publicClient = createPublicClient({ chain: foundry, transport: http(deployment.rpcUrl) });
const walletClient = createWalletClient({ account, chain: foundry, transport: http(deployment.rpcUrl) });
const manager = { address: deployment.contracts.OmniETFManager as `0x${string}`, abi: managerArtifact.abi as Abi };
const share = { address: deployment.contracts.OmniETFShare as `0x${string}`, abi: shareArtifact.abi as Abi };
const usdc = { address: deployment.contracts.MockUSDC as `0x${string}`, abi: usdcArtifact.abi as Abi };

async function tx(address: `0x${string}`, abi: Abi, functionName: string, args: readonly unknown[] = []) {
  const hash = await walletClient.writeContract({ address, abi, functionName, args });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}


async function assertReinitializeBlocked() {
  const connection = new Connection(svmDeployment.rpcUrl, 'confirmed');
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(svmDeployment.payerKeypair, 'utf8')) as number[]));
  const programId = new PublicKey(svmDeployment.programId);
  const state = new PublicKey(svmDeployment.state);
  const initAgain = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: state, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([0]),
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(initAgain), [authority]);
  } catch {
    console.log('svm reinitialize blocked');
    return;
  }
  throw new Error('SVM state reinitialize unexpectedly succeeded');
}

function relay(kind: string, id: bigint) {
  execFileSync('./node_modules/.bin/tsx', ['scripts/relayer-local.ts', '--once', kind, id.toString()], { stdio: 'inherit' });
}

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== 31337) throw new Error(`Expected Anvil 31337, got ${chainId}`);
  if (deployment.mode !== 'svm') throw new Error(`Expected BRIDGE_MODE=svm deployment, got ${deployment.mode}`);

  await tx(usdc.address, usdc.abi, 'approve', [manager.address, parseUnits('100', 6)]);
  const depositId = (await publicClient.readContract({ ...manager, functionName: 'nextRequestId' })) as bigint;
  await tx(manager.address, manager.abi, 'requestDeposit', [parseUnits('100', 6)]);
  relay('allocation', depositId);

  const balanceAfterDeposit = (await publicClient.readContract({ ...share, functionName: 'balanceOf', args: [account.address] })) as bigint;
  if (balanceAfterDeposit <= 0n) throw new Error('Expected mETF balance after SVM allocation ack');

  const rebalanceId = (await publicClient.readContract({ ...manager, functionName: 'nextRequestId' })) as bigint;
  await tx(manager.address, manager.abi, 'requestRebalance');
  relay('rebalance', rebalanceId);

  const redeemId = (await publicClient.readContract({ ...manager, functionName: 'nextRequestId' })) as bigint;
  await tx(manager.address, manager.abi, 'requestRedeem', [parseUnits('40', 18)]);
  relay('redeem', redeemId);

  const claimable = (await publicClient.readContract({ ...manager, functionName: 'totalClaimableUsdc' })) as bigint;
  if (claimable <= 0n) throw new Error('Expected claimable USDC after SVM redeem ack');
  await tx(manager.address, manager.abi, 'claimRedeem', [redeemId]);

  const finalShare = (await publicClient.readContract({ ...share, functionName: 'balanceOf', args: [account.address] })) as bigint;
  const portfolioValue = (await publicClient.readContract({ ...manager, functionName: 'totalPortfolioValueUsdc' })) as bigint;
  await assertReinitializeBlocked();
  console.log(`cross-smoke ok: finalShare=${finalShare} portfolioValue=${portfolioValue}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
