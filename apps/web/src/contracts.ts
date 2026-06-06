import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseUnits, type Abi, type Chain, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, foundry } from 'viem/chains';
import localDeployment from '../../../deployments/local.json';
import managerArtifact from '../../../contracts/out/OmniETFManager.sol/OmniETFManager.json';
import shareArtifact from '../../../contracts/out/OmniETFShare.sol/OmniETFShare.json';
import usdcArtifact from '../../../contracts/out/MockUSDC.sol/MockUSDC.json';
import mockBridgeArtifact from '../../../contracts/out/MockBridgeAdapter.sol/MockBridgeAdapter.json';
import localSvmBridgeArtifact from '../../../contracts/out/LocalSvmBridgeAdapter.sol/LocalSvmBridgeAdapter.json';
import portfolioArtifact from '../../../contracts/out/MockSolanaPortfolio.sol/MockSolanaPortfolio.json';
import oracleArtifact from '../../../contracts/out/MockPriceOracle.sol/MockPriceOracle.json';

type BridgeContractName = 'MockBridgeAdapter' | 'LocalSvmBridgeAdapter';

type Deployment = {
  chainName?: string;
  chainId: number;
  rpcUrl: string;
  deployer: string;
  demoUser?: string;
  demoPrivateKey?: `0x${string}`;
  mode?: string;
  bridgeContractName?: BridgeContractName;
  assets: Record<'AAPLX' | 'TSLAX' | 'NVDAX', `0x${string}`>;
  contracts: {
    MockUSDC: string;
    MockPriceOracle: string;
    OmniETFShare: string;
    OmniETFManager: string;
    bridge?: string;
    LocalSvmBridgeAdapter?: string;
    MockBridgeAdapter?: string;
    MockSolanaPortfolio?: string;
  };
};

const DEFAULT_ASSETS = {
  AAPLX: '0x4141504c78000000000000000000000000000000000000000000000000000000',
  TSLAX: '0x54534c4178000000000000000000000000000000000000000000000000000000',
  NVDAX: '0x4e56444178000000000000000000000000000000000000000000000000000000',
} as const;

const env = import.meta.env;

function envDeployment(): Deployment | null {
  if (!env.VITE_MANAGER_ADDRESS) return null;
  const chainId = Number(env.VITE_EVM_CHAIN_ID ?? 84532);
  const bridgeContractName = (env.VITE_BRIDGE_CONTRACT_NAME ?? 'LocalSvmBridgeAdapter') as BridgeContractName;
  const bridge = env.VITE_BRIDGE_ADDRESS as string;
  return {
    chainName: env.VITE_CHAIN_NAME ?? (chainId === 84532 ? 'base-sepolia' : `chain-${chainId}`),
    chainId,
    rpcUrl: env.VITE_EVM_RPC_URL ?? 'https://sepolia.base.org',
    deployer: env.VITE_DEMO_USER,
    demoUser: env.VITE_DEMO_USER,
    demoPrivateKey: env.VITE_DEMO_PRIVATE_KEY as `0x${string}` | undefined,
    mode: env.VITE_DEMO_MODE ?? 'svm',
    bridgeContractName,
    assets: DEFAULT_ASSETS,
    contracts: {
      MockUSDC: env.VITE_MOCK_USDC_ADDRESS,
      MockPriceOracle: env.VITE_ORACLE_ADDRESS,
      OmniETFShare: env.VITE_SHARE_ADDRESS,
      OmniETFManager: env.VITE_MANAGER_ADDRESS,
      bridge,
      [bridgeContractName]: bridge,
    },
  };
}

const local = (envDeployment() ?? localDeployment) as Deployment;
const bridgeContractName = local.bridgeContractName ?? 'MockBridgeAdapter';
const bridgeArtifact = bridgeContractName === 'LocalSvmBridgeAdapter' ? localSvmBridgeArtifact : mockBridgeArtifact;

function chainFor(deployment: Deployment): Chain {
  if (deployment.chainId === foundry.id) return foundry;
  if (deployment.chainId === baseSepolia.id) return baseSepolia;
  return defineChain({
    id: deployment.chainId,
    name: deployment.chainName ?? `chain-${deployment.chainId}`,
    nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
    rpcUrls: { default: { http: [deployment.rpcUrl] } },
  });
}

const chain = chainFor(local);
const privateKey = local.demoPrivateKey ?? (env.VITE_DEMO_PRIVATE_KEY as `0x${string}` | undefined);
export const DEMO_USER = (local.demoUser ?? local.deployer) as `0x${string}`;
export const DEPLOYER = local.deployer as `0x${string}`;
export const DEMO_MODE = local.mode ?? 'mock';
export const RELAYER_URL = env.VITE_RELAYER_URL ?? 'http://127.0.0.1:8787';
export const EXPECTED_CHAIN_ID = local.chainId;
export const CHAIN_LABEL = local.chainName ?? chain.name;
export const READ_ONLY = !privateKey;
export const EVM_EXPLORER_TX_BASE = local.chainId === 84532 ? 'https://sepolia.basescan.org/tx/' : '';
export const SOLANA_EXPLORER_TX_BASE = 'https://explorer.solana.com/tx/';

export const account = privateKey ? privateKeyToAccount(privateKey) : null;

export const publicClient = createPublicClient({
  chain,
  transport: http(local.rpcUrl),
});

export const walletClient: WalletClient | null = account
  ? createWalletClient({
      account,
      chain,
      transport: http(local.rpcUrl),
    })
  : null;

export const contracts = {
  manager: {
    address: local.contracts.OmniETFManager as `0x${string}`,
    abi: managerArtifact.abi as Abi,
  },
  share: {
    address: local.contracts.OmniETFShare as `0x${string}`,
    abi: shareArtifact.abi as Abi,
  },
  usdc: {
    address: local.contracts.MockUSDC as `0x${string}`,
    abi: usdcArtifact.abi as Abi,
  },
  bridge: {
    address: (local.contracts.bridge ?? local.contracts[bridgeContractName]) as `0x${string}`,
    abi: bridgeArtifact.abi as Abi,
    name: bridgeContractName,
  },
  portfolio: local.contracts.MockSolanaPortfolio
    ? {
        address: local.contracts.MockSolanaPortfolio as `0x${string}`,
        abi: portfolioArtifact.abi as Abi,
      }
    : null,
  oracle: {
    address: local.contracts.MockPriceOracle as `0x${string}`,
    abi: oracleArtifact.abi as Abi,
  },
};

export const assetIds = local.assets as Record<'AAPLX' | 'TSLAX' | 'NVDAX', `0x${string}`>;

export function usdc(value: bigint): string {
  return `${Number(formatUnits(value, 6)).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC`;
}

export function shares(value: bigint): string {
  return `${Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} mETF`;
}

export function nav(value: bigint): string {
  return `$${Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

export function synthetic(value: bigint): string {
  return `${Number(formatUnits(value, 6)).toLocaleString(undefined, { maximumFractionDigits: 4 })} synthetic USDC`;
}

export function evmTxUrl(hash: string): string | null {
  return EVM_EXPLORER_TX_BASE ? `${EVM_EXPLORER_TX_BASE}${hash}` : null;
}

export function solanaTxUrl(signature: string): string {
  return `${SOLANA_EXPLORER_TX_BASE}${signature}${CHAIN_LABEL === 'base-sepolia' ? '?cluster=devnet' : '?cluster=devnet'}`;
}

export const parseUsdc = (value: string) => parseUnits(value || '0', 6);
export const parseShares = (value: string) => parseUnits(value || '0', 18);

export async function wait(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash });
}
