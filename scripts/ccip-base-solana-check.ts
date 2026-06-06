import { createPublicClient, http, type Abi } from 'viem';
import { baseSepolia } from 'viem/chains';

const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? process.env.RPC_URL ?? 'https://sepolia.base.org';
const BASE_SEPOLIA_ROUTER = '0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93';
const BASE_SEPOLIA_SELECTOR = 10344971235874465080n;
const SOLANA_DEVNET_SELECTOR = 16423721717087811551n;
const SOLANA_DEVNET_ROUTER = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C';
const BASE_SEPOLIA_LINK = '0xE4aB69C077896252FAFBD49EFD26B5D171A32410';

const routerAbi = [
  { inputs: [{ internalType: 'uint64', name: 'chainSelector', type: 'uint64' }], name: 'isChainSupported', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint64', name: 'chainSelector', type: 'uint64' }], name: 'getSupportedTokens', outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }], stateMutability: 'view', type: 'function' },
] as const satisfies Abi;

async function main() {
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) });
  const [chainId, supportsSolana] = await Promise.all([
    publicClient.getChainId(),
    publicClient.readContract({ address: BASE_SEPOLIA_ROUTER, abi: routerAbi, functionName: 'isChainSupported', args: [SOLANA_DEVNET_SELECTOR] }),
  ]);
  let supportedTokens: readonly `0x${string}`[] | string = [];
  try {
    supportedTokens = await publicClient.readContract({ address: BASE_SEPOLIA_ROUTER, abi: routerAbi, functionName: 'getSupportedTokens', args: [SOLANA_DEVNET_SELECTOR] });
  } catch (error) {
    supportedTokens = `Router confirms the lane but getSupportedTokens reverted for this SVM destination. Use the Chainlink CCIP Directory or ccip-cli get-supported-tokens for current token addresses. ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
  }

  console.log(JSON.stringify({
    source: {
      network: 'Base Sepolia',
      chainId,
      chainSelector: BASE_SEPOLIA_SELECTOR.toString(),
      router: BASE_SEPOLIA_ROUTER,
      linkToken: BASE_SEPOLIA_LINK,
    },
    destination: {
      network: 'Solana Devnet',
      chainSelector: SOLANA_DEVNET_SELECTOR.toString(),
      routerProgram: SOLANA_DEVNET_ROUTER,
    },
    lane: {
      supportsSolana,
      supportedTokens,
      statusUrl: 'https://ccip.chain.link/',
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
