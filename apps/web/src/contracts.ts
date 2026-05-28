import { createPublicClient, createWalletClient, formatUnits, http, parseUnits, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import deployment from '../../../deployments/local.json';
import managerArtifact from '../../../contracts/out/OmniETFManager.sol/OmniETFManager.json';
import shareArtifact from '../../../contracts/out/OmniETFShare.sol/OmniETFShare.json';
import usdcArtifact from '../../../contracts/out/MockUSDC.sol/MockUSDC.json';
import mockBridgeArtifact from '../../../contracts/out/MockBridgeAdapter.sol/MockBridgeAdapter.json';
import localSvmBridgeArtifact from '../../../contracts/out/LocalSvmBridgeAdapter.sol/LocalSvmBridgeAdapter.json';
import portfolioArtifact from '../../../contracts/out/MockSolanaPortfolio.sol/MockSolanaPortfolio.json';
import oracleArtifact from '../../../contracts/out/MockPriceOracle.sol/MockPriceOracle.json';

type Deployment = typeof deployment & {
  mode?: string;
  bridgeContractName?: 'MockBridgeAdapter' | 'LocalSvmBridgeAdapter';
  contracts: typeof deployment.contracts & {
    bridge?: string;
    LocalSvmBridgeAdapter?: string;
    MockBridgeAdapter?: string;
    MockSolanaPortfolio?: string;
  };
};

const local = deployment as Deployment;
const bridgeContractName = local.bridgeContractName ?? 'MockBridgeAdapter';
const bridgeArtifact = bridgeContractName === 'LocalSvmBridgeAdapter' ? localSvmBridgeArtifact : mockBridgeArtifact;

export const DEMO_USER = local.demoUser as `0x${string}`;
export const DEPLOYER = local.deployer as `0x${string}`;
export const DEMO_MODE = local.mode ?? 'mock';
export const RELAYER_URL = 'http://127.0.0.1:8787';
export const account = privateKeyToAccount(local.demoPrivateKey as `0x${string}`);

export const publicClient = createPublicClient({
  chain: foundry,
  transport: http(local.rpcUrl),
});

export const walletClient = createWalletClient({
  account,
  chain: foundry,
  transport: http(local.rpcUrl),
});

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

export const parseUsdc = (value: string) => parseUnits(value || '0', 6);
export const parseShares = (value: string) => parseUnits(value || '0', 18);

export async function wait(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash });
}
