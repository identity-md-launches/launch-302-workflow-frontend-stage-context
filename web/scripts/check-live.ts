import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, defineChain, fallback, http } from 'viem';
import { readSnapshot } from '../src/chain';
import type { Config } from '../src/config';

const manifest = JSON.parse(readFileSync(new URL('../../dist/imd-deployment.json', import.meta.url), 'utf8'));
const contracts = manifest.contracts.map((c: any) => ({ ...c, abi: JSON.parse(readFileSync(new URL('../../dist/' + c.abiPath, import.meta.url), 'utf8')) }));
const chain = defineChain({ id: manifest.chainId, name: manifest.network.name, nativeCurrency: manifest.network.nativeCurrency, rpcUrls: { default: { http: manifest.network.rpcUrls } } });
const config = { manifest, app: contracts.find((c: any) => c.name === 'BurnLeaderboard'), token: contracts.find((c: any) => c.name === 'LaunchToken'), chain,
  client: createPublicClient({ chain, transport: fallback(manifest.network.rpcUrls.map((url: string) => http(url, { timeout: 12_000, retryCount: 1 }))) }) } as Config;
const snapshot = await readSnapshot(config);
const codes = await Promise.all(manifest.contracts.map(async (c: any) => ({ name: c.name, address: c.address,
  codeBytes: ((await config.client.getCode({ address: c.address, blockNumber: snapshot.blockNumber }))!.length - 2) / 2 })));
const result = { checkedAt: new Date().toISOString(), check: 'Read-only public RPC; no wallet, signatures or broadcasts',
  chainId: await config.client.getChainId(), sourceCommit: manifest.sourceCommit, contracts: codes, snapshot };
const text = JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
writeFileSync(new URL('../../docs/evidence/live-read.json', import.meta.url), text);
console.log(text);
