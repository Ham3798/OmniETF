import { PublicKey } from '@solana/web3.js';
import { concat, createPublicClient, createWalletClient, encodeAbiParameters, getAddress, http, parseUnits, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? process.env.RPC_URL;
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
const SOLANA_RECIPIENT = process.env.SOLANA_RECIPIENT;
const CCIP_TOKEN_ADDRESS = process.env.CCIP_TOKEN_ADDRESS as `0x${string}` | undefined;
const CCIP_TOKEN_AMOUNT = process.env.CCIP_TOKEN_AMOUNT ?? '1';
const CCIP_TOKEN_DECIMALS = Number(process.env.CCIP_TOKEN_DECIMALS ?? 18);
const BASE_SEPOLIA_ROUTER = '0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93';
const SOLANA_DEVNET_SELECTOR = 16423721717087811551n;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}` as `0x${string}`;
const SVM_EXTRA_ARGS_V1_TAG = '0x1f3b3aba' as `0x${string}`;
const NATIVE_FEE_TOKEN = '0x0000000000000000000000000000000000000000' as const;

const routerAbi = [
  { inputs: [{ internalType: 'uint64', name: 'chainSelector', type: 'uint64' }], name: 'isChainSupported', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint64', name: 'destinationChainSelector', type: 'uint64' }, { components: [{ internalType: 'bytes', name: 'receiver', type: 'bytes' }, { internalType: 'bytes', name: 'data', type: 'bytes' }, { components: [{ internalType: 'address', name: 'token', type: 'address' }, { internalType: 'uint256', name: 'amount', type: 'uint256' }], internalType: 'struct Client.EVMTokenAmount[]', name: 'tokenAmounts', type: 'tuple[]' }, { internalType: 'address', name: 'feeToken', type: 'address' }, { internalType: 'bytes', name: 'extraArgs', type: 'bytes' }], internalType: 'struct Client.EVM2AnyMessage', name: 'message', type: 'tuple' }], name: 'getFee', outputs: [{ internalType: 'uint256', name: 'fee', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint64', name: 'destinationChainSelector', type: 'uint64' }, { components: [{ internalType: 'bytes', name: 'receiver', type: 'bytes' }, { internalType: 'bytes', name: 'data', type: 'bytes' }, { components: [{ internalType: 'address', name: 'token', type: 'address' }, { internalType: 'uint256', name: 'amount', type: 'uint256' }], internalType: 'struct Client.EVMTokenAmount[]', name: 'tokenAmounts', type: 'tuple[]' }, { internalType: 'address', name: 'feeToken', type: 'address' }, { internalType: 'bytes', name: 'extraArgs', type: 'bytes' }], internalType: 'struct Client.EVM2AnyMessage', name: 'message', type: 'tuple' }], name: 'ccipSend', outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }], stateMutability: 'payable', type: 'function' },
] as const satisfies Abi;

const erc20Abi = [
  { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
] as const satisfies Abi;

function solanaAddressBytes32(address: string): `0x${string}` {
  return `0x${Buffer.from(new PublicKey(address).toBytes()).toString('hex')}`;
}

function svmExtraArgs(tokenReceiver: `0x${string}`): `0x${string}` {
  const encoded = encodeAbiParameters([
    {
      type: 'tuple',
      components: [
        { name: 'computeUnits', type: 'uint32' },
        { name: 'accountIsWritableBitmap', type: 'uint64' },
        { name: 'allowOutOfOrderExecution', type: 'bool' },
        { name: 'tokenReceiver', type: 'bytes32' },
        { name: 'accounts', type: 'bytes32[]' },
      ],
    },
  ], [{ computeUnits: 0, accountIsWritableBitmap: 0n, allowOutOfOrderExecution: true, tokenReceiver, accounts: [] }]);
  return concat([SVM_EXTRA_ARGS_V1_TAG, encoded]);
}

async function main() {
  if (!BASE_SEPOLIA_RPC_URL) throw new Error('Set BASE_SEPOLIA_RPC_URL or RPC_URL.');
  if (!DEPLOYER_PRIVATE_KEY) throw new Error('Set DEPLOYER_PRIVATE_KEY for the Base Sepolia sender wallet.');
  if (!SOLANA_RECIPIENT) throw new Error('Set SOLANA_RECIPIENT to a Solana Devnet wallet address.');

  const account = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) });
  const supportsSolana = await publicClient.readContract({ address: BASE_SEPOLIA_ROUTER, abi: routerAbi, functionName: 'isChainSupported', args: [SOLANA_DEVNET_SELECTOR] });
  if (!supportsSolana) throw new Error('Base Sepolia router does not currently support Solana Devnet.');

  if (!CCIP_TOKEN_ADDRESS) {
    console.log(JSON.stringify({
      error: 'Set CCIP_TOKEN_ADDRESS to a Base Sepolia token supported for the Solana Devnet lane.',
      tokenSource: 'Run npm run ccip:base-solana:check and confirm against https://docs.chain.link/ccip/directory/testnet/chain/ethereum-testnet-sepolia-base-1',
    }, null, 2));
    return;
  }

  const token = getAddress(CCIP_TOKEN_ADDRESS);

  const amount = parseUnits(CCIP_TOKEN_AMOUNT, CCIP_TOKEN_DECIMALS);
  const message = {
    receiver: ZERO_BYTES32,
    data: '0x' as `0x${string}`,
    tokenAmounts: [{ token, amount }],
    feeToken: NATIVE_FEE_TOKEN,
    extraArgs: svmExtraArgs(solanaAddressBytes32(SOLANA_RECIPIENT)),
  };
  const fee = await publicClient.readContract({ address: BASE_SEPOLIA_ROUTER, abi: routerAbi, functionName: 'getFee', args: [SOLANA_DEVNET_SELECTOR, message] });

  const approveHash = await walletClient.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [BASE_SEPOLIA_ROUTER, amount] });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  const sendHash = await walletClient.writeContract({ address: BASE_SEPOLIA_ROUTER, abi: routerAbi, functionName: 'ccipSend', args: [SOLANA_DEVNET_SELECTOR, message], value: fee });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: sendHash });

  console.log(JSON.stringify({
    approveTx: approveHash,
    ccipSendTx: sendHash,
    feeWei: fee.toString(),
    status: receipt.status,
    ccipExplorerHint: `https://ccip.chain.link/#/side-drawer/msg/${sendHash}`,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
