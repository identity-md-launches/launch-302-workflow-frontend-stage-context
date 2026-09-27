import { createPublicClient, defineChain, fallback, http, isAddress, type Abi, type Address } from 'viem';
import { abiHash } from './integrity';

export type Deployment = {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  deploymentBlock: number;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  network: {
    chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[]; uniswapV4: Record<string, Address>;
  };
  walletAddChain: { chainId: `0x${string}`; chainName: string; rpcUrls: string[]; nativeCurrency: Deployment['network']['nativeCurrency']; blockExplorerUrls: string[] };
};
export type Binding = Deployment['contracts'][number] & { abi: Abi };
const localPath = (path: string) => /^[\w./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..');

async function json(path: string) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok) throw Error(`Unable to load ${path}. Reload this page or check the export.`);
  return response.json();
}

export async function loadConfig() {
  const manifest = await json('imd-deployment.json') as Deployment;
  if (manifest.version !== 1 || manifest.chainId !== manifest.network?.chainId ||
    Number(manifest.walletAddChain?.chainId) !== manifest.chainId || !manifest.network.rpcUrls.length ||
    !Number.isSafeInteger(manifest.deploymentBlock) || manifest.deploymentBlock < 0 ||
    manifest.contracts.length !== 2) throw Error('Deployment configuration is invalid. Transactions are disabled.');
  const bindings = await Promise.all(manifest.contracts.map(async contract => {
    if (!isAddress(contract.address) || !localPath(contract.abiPath)) throw Error('Unsafe contract configuration.');
    const abi = await json(contract.abiPath) as Abi;
    if (!Array.isArray(abi) || abiHash(abi) !== contract.abiHash) throw Error(`ABI verification failed for ${contract.name}.`);
    return { ...contract, abi: abi as Abi };
  }));
  const app = bindings.find(c => c.name === 'BurnLeaderboard');
  const token = bindings.find(c => c.name === 'LaunchToken');
  if (!app || !token) throw Error('The deployment must include BurnLeaderboard and LaunchToken.');
  const chain = defineChain({ id: manifest.chainId, name: manifest.network.name,
    nativeCurrency: manifest.network.nativeCurrency, testnet: manifest.network.testnet,
    rpcUrls: { default: { http: manifest.network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: manifest.network.explorer } },
  });
  const client = createPublicClient({ chain, batch: { multicall: false },
    transport: fallback(manifest.network.rpcUrls.map(url => http(url, { timeout: 12_000, retryCount: 1 }))) });
  return { manifest, app, token, chain, client };
}
export type Config = Awaited<ReturnType<typeof loadConfig>>;
