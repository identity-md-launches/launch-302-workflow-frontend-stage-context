import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits, type Address } from 'viem';
import { parseAmount, reconstruct, numberText, type BurnEvent } from '../src/domain';
import { switchNetwork, transact, readRanks, type Provider } from '../src/chain';
import type { Config } from '../src/config';

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const event = (n: number, total: bigint, position: number, season = 0n, amount = total): BurnEvent => ({ account: address(n), amount, lifetimeTotal: total, season, blockNumber: 100n, transactionIndex: 0, logIndex: position });

test('amounts use exact bigint units and reject rounding, exponents, negatives, zero and overflow', () => {
  assert.equal(parseAmount('123.000000000000000001', 18), 123000000000000000001n);
  for (const invalid of ['0', '-1', '1e3', 'NaN', '1,000', '.1', '1.0000000000000000001', '1' + '0'.repeat(78)]) assert.throws(() => parseAmount(invalid, 18));
  assert.equal(numberText(1n, 18), '<0.0001');
  assert.equal(numberText(parseUnits('1000000.123456', 18), 18), '1,000,000.1234');
});

test('event ranks include the 11th account, handle reordered logs and ties by attainment, and exclude old seasons', () => {
  const events = Array.from({ length: 11 }, (_, i) => event(i + 1, BigInt(100 - i), i));
  events.push(event(11, 100n, 11, 1n, 10n));
  events.push(event(2, 101n, 12, 1n, 2n));
  const ranks = reconstruct([...events].reverse().concat(events[0]), 1n);
  assert.equal(ranks.all.length, 11);
  assert.deepEqual(ranks.all.slice(0, 3).map(e => e.account), [address(2), address(1), address(11)]);
  assert.deepEqual(ranks.current.map(e => [e.account, e.total]), [[address(11), 10n], [address(2), 2n]]);
  assert.equal(reconstruct(events, 2n).current.length, 0);
});

test('same-block transaction order decides ties before log index', () => {
  const a = event(1, 10n, 1); a.transactionIndex = 1;
  const b = event(2, 10n, 9); b.transactionIndex = 0;
  assert.equal(reconstruct([a, b], 0n).all[0].account, address(2));
});

test('unknown chain offers exact add-chain configuration then switches again; rejection never adds', async () => {
  const add = { chainId: '0xaa36a7', chainName: 'Fixture', rpcUrls: ['https://example.test'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } };
  const config = { manifest: { walletAddChain: add } } as unknown as Config;
  const calls: any[] = [];
  const provider = { request: async (request: any) => { calls.push(request); if (calls.length === 1) throw { code: 4902 }; } } as Provider;
  await switchNetwork(provider, config);
  assert.deepEqual(calls.map(c => c.method), ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  assert.deepEqual(calls[1].params, [add]);
  const rejected: any[] = [];
  await assert.rejects(switchNetwork({ request: async (r: any) => { rejected.push(r); throw { code: 4001 }; } } as Provider, config));
  assert.equal(rejected.length, 1);
});

test('transaction flow blocks wrong chains, wrong accounts and simulation failures before a signing request', async () => {
  const calls: string[] = [];
  const config = { manifest: { chainId: 10 }, app: { address: address(1) }, token: { address: address(2) }, client: {
    getChainId: async () => 10, getCode: async () => '0x6000', readContract: async () => address(2),
    simulateContract: async () => { throw Error('Fixture simulation revert'); },
  } } as unknown as Config;
  let chain = '0x1'; let current = address(3);
  const provider = { request: async ({ method }: any) => { calls.push(method); return method === 'eth_chainId' ? chain : [current]; } } as Provider;
  await assert.rejects(transact(config, provider, address(3), 'burn', 1n, () => {}), /wallet or network changed/);
  chain = '0xa'; current = address(4);
  await assert.rejects(transact(config, provider, address(3), 'burn', 1n, () => {}), /wallet or network changed/);
  current = address(3);
  await assert.rejects(transact(config, provider, address(3), 'burn', 1n, () => {}), /simulation revert/);
  assert.equal(calls.includes('eth_sendTransaction'), false);
});

test('event reader paginates, shrinks refused ranges and rejects incomplete histories or reorgs', async () => {
  const ranges: bigint[] = [];
  let hash = '0xabc';
  const config = { app: {}, manifest: { deploymentBlock: 1 }, client: {
    getContractEvents: async ({ fromBlock, toBlock }: any) => { ranges.push(toBlock - fromBlock + 1n); if (toBlock - fromBlock >= 1000n) throw Error('Range limit'); return []; },
    getBlock: async () => ({ hash }),
  } } as unknown as Config;
  const snap: any = { blockNumber: 5500n, blockHash: hash, season: 0n, total: 0n, all: [], current: [] };
  assert.deepEqual(await readRanks(config, snap, () => false, () => {}), { all: [], current: [] });
  assert.ok(ranges.includes(5000n)); assert.ok(ranges.some(n => n < 1000n));
  await assert.rejects(readRanks(config, { ...snap, total: 1n }, () => false, () => {}), /incomplete/);
  hash = '0xdef';
  await assert.rejects(readRanks(config, snap, () => false, () => {}), /reorganized/);
  await assert.rejects(readRanks(config, snap, () => true, () => {}), /cancelled/);
});
