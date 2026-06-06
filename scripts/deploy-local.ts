import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, foundry } from 'viem/chains';

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const DEFAULT_ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEPLOYER_PRIVATE_KEY =
  (process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined) ?? DEFAULT_ANVIL_PRIVATE_KEY;
const EXPECTED_CHAIN_ID = Number(process.env.EXPECTED_CHAIN_ID ?? 31337);
const CHAIN_NAME = process.env.CHAIN_NAME ?? (EXPECTED_CHAIN_ID === 84532 ? 'base-sepolia' : 'local');
const DEPLOYMENT_FILE = process.env.DEPLOYMENT_FILE ?? 'deployments/local.json';
const WAD = 10n ** 18n;
const USDC = 10n ** 6n;
const BRIDGE_MODE = process.env.BRIDGE_MODE ?? 'mock';
const SEED_DEMO_USDC = process.env.SEED_DEMO_USDC !== '0';

const ASSETS = {
  AAPLX: '0x4141504c78000000000000000000000000000000000000000000000000000000',
  TSLAX: '0x54534c4178000000000000000000000000000000000000000000000000000000',
  NVDAX: '0x4e56444178000000000000000000000000000000000000000000000000000000',
} as const;

type Artifact = {
  abi: Abi;
  bytecode: { object: `0x${string}` };
};

function chainFor(chainId: number): Chain {
  if (chainId === foundry.id) return foundry;
  if (chainId === baseSepolia.id) return baseSepolia;
  return defineChain({
    id: chainId,
    name: CHAIN_NAME,
    nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  });
}

async function artifact(contractFile: string, contractName: string): Promise<Artifact> {
  const artifactPath = join('contracts', 'out', contractFile, `${contractName}.json`);
  return JSON.parse(await readFile(artifactPath, 'utf8')) as Artifact;
}

async function main() {
  if (EXPECTED_CHAIN_ID !== 31337 && DEPLOYER_PRIVATE_KEY === DEFAULT_ANVIL_PRIVATE_KEY) {
    throw new Error('DEPLOYER_PRIVATE_KEY must be set for non-local deployments; refusing to use the public Anvil key.');
  }

  const account = privateKeyToAccount(DEPLOYER_PRIVATE_KEY);
  const expectedChain = chainFor(EXPECTED_CHAIN_ID);
  const publicClient = createPublicClient({ chain: expectedChain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: expectedChain, transport: http(RPC_URL) });

  const chainId = await publicClient.getChainId();
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Expected chain id ${EXPECTED_CHAIN_ID}, got ${chainId}`);
  }

  const mockUsdc = await artifact('MockUSDC.sol', 'MockUSDC');
  const oracle = await artifact('MockPriceOracle.sol', 'MockPriceOracle');
  const share = await artifact('OmniETFShare.sol', 'OmniETFShare');
  const manager = await artifact('OmniETFManager.sol', 'OmniETFManager');
  const portfolio = await artifact('MockSolanaPortfolio.sol', 'MockSolanaPortfolio');
  const mockBridge = await artifact('MockBridgeAdapter.sol', 'MockBridgeAdapter');
  const localSvmBridge = await artifact('LocalSvmBridgeAdapter.sol', 'LocalSvmBridgeAdapter');

  async function deploy(name: string, abi: Abi, bytecode: `0x${string}`, args: readonly unknown[] = []) {
    const hash = await walletClient.deployContract({ abi, bytecode, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`No contract address for ${name}`);
    console.log(`${name}: ${receipt.contractAddress}`);
    return receipt.contractAddress;
  }

  const usdcAddress = await deploy('MockUSDC', mockUsdc.abi, mockUsdc.bytecode.object);
  const oracleAddress = await deploy('MockPriceOracle', oracle.abi, oracle.bytecode.object, [account.address]);

  await walletClient.writeContract({
    address: oracleAddress,
    abi: oracle.abi,
    functionName: 'setPrice',
    args: [ASSETS.AAPLX, 100n * WAD],
  }).then((hash) => publicClient.waitForTransactionReceipt({ hash }));
  await walletClient.writeContract({
    address: oracleAddress,
    abi: oracle.abi,
    functionName: 'setPrice',
    args: [ASSETS.TSLAX, 200n * WAD],
  }).then((hash) => publicClient.waitForTransactionReceipt({ hash }));
  await walletClient.writeContract({
    address: oracleAddress,
    abi: oracle.abi,
    functionName: 'setPrice',
    args: [ASSETS.NVDAX, 50n * WAD],
  }).then((hash) => publicClient.waitForTransactionReceipt({ hash }));

  const shareAddress = await deploy('OmniETFShare', share.abi, share.bytecode.object, [account.address]);
  const managerAddress = await deploy('OmniETFManager', manager.abi, manager.bytecode.object, [
    usdcAddress,
    shareAddress,
    account.address,
  ]);
  let portfolioAddress: `0x${string}` | null = null;
  let bridgeAddress: `0x${string}`;
  let bridgeContractName: 'MockBridgeAdapter' | 'LocalSvmBridgeAdapter';

  if (BRIDGE_MODE === 'svm') {
    bridgeAddress = await deploy('LocalSvmBridgeAdapter', localSvmBridge.abi, localSvmBridge.bytecode.object, [
      usdcAddress,
      managerAddress,
      account.address,
    ]);
    bridgeContractName = 'LocalSvmBridgeAdapter';
  } else {
    portfolioAddress = await deploy('MockSolanaPortfolio', portfolio.abi, portfolio.bytecode.object, [
      oracleAddress,
      account.address,
    ]);
    bridgeAddress = await deploy('MockBridgeAdapter', mockBridge.abi, mockBridge.bytecode.object, [
      usdcAddress,
      managerAddress,
      portfolioAddress,
      account.address,
    ]);
    bridgeContractName = 'MockBridgeAdapter';
  }

  const setupCalls: Array<[address: `0x${string}`, abi: Abi, functionName: string, args: readonly unknown[]]> = [
    [shareAddress, share.abi, 'setManager', [managerAddress]],
    [managerAddress, manager.abi, 'setBridge', [bridgeAddress]],
  ];
  if (portfolioAddress) {
    setupCalls.push([portfolioAddress, portfolio.abi, 'setExecutor', [bridgeAddress]]);
  }
  if (SEED_DEMO_USDC) {
    setupCalls.push([usdcAddress, mockUsdc.abi, 'mint', [account.address, 1_000n * USDC]]);
  }

  for (const [address, abi, functionName, args] of setupCalls) {
    const hash = await walletClient.writeContract({ address, abi, functionName, args });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  await mkdir('deployments', { recursive: true });
  const deployment = {
    chainName: CHAIN_NAME,
    chainId,
    rpcUrl: RPC_URL,
    deployer: account.address,
    demoUser: account.address,
    ...(chainId === 31337
      ? {
          demoPrivateKey: DEPLOYER_PRIVATE_KEY,
          note: 'Local Anvil demo deployment. Private key is the public default Anvil key; never use it outside local demos.',
        }
      : {
          note: 'Public testnet deployment. Private keys are intentionally not written; set DEPLOYER_PRIVATE_KEY when running relayer/smoke scripts.',
        }),
    mode: BRIDGE_MODE,
    bridgeContractName,
    assets: ASSETS,
    contracts: {
      MockUSDC: usdcAddress,
      MockPriceOracle: oracleAddress,
      OmniETFShare: shareAddress,
      OmniETFManager: managerAddress,
      ...(portfolioAddress ? { MockSolanaPortfolio: portfolioAddress } : {}),
      [bridgeContractName]: bridgeAddress,
      bridge: bridgeAddress,
    },
  };
  await writeFile(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2) + '\n');
  console.log(`Wrote ${DEPLOYMENT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
