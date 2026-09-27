import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters, parseUnits, toHex, zeroAddress } from 'viem';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(root + 'dist/imd-deployment.json'));
const app = manifest.contracts.find(c => c.name === 'BurnLeaderboard');
const token = manifest.contracts.find(c => c.name === 'LaunchToken');
const appAbi = JSON.parse(readFileSync(root + 'dist/' + app.abiPath));
const tokenAbi = JSON.parse(readFileSync(root + 'dist/' + token.abiPath));
const wallet = n => `0x${n.toString(16).padStart(40, '0')}`;
const account = wallet(11), other = wallet(77);
const blockNumber = BigInt(manifest.deploymentBlock) + 20n;
const hash = '0x' + 'ab'.repeat(32);
const txHash = '0x' + 'cd'.repeat(32);
const unit = n => parseUnits(String(n), 18);
const initial = Array.from({ length: 12 }, (_, i) => ({ account: wallet(i + 1), total: unit(120 - i * 10) }));
const calls = {};
for (const stage of ['initial', 'approved', 'burned', 'swept']) {
  const burned = stage === 'burned' || stage === 'swept';
  const entries = initial.map(e => e.account === account && burned ? { ...e, total: e.total + unit(100) } : e);
  const board = [...entries].sort((a, b) => a.total === b.total ? Number(BigInt(a.account) - BigInt(b.account)) : a.total > b.total ? -1 : 1).slice(0, 10);
  const values = { token: token.address, DEAD: '0x000000000000000000000000000000000000dEaD', SEASON_DURATION: 604800n,
    deployTimestamp: 1790481600n, currentSeason: 0n, totalBurned: entries.reduce((n, e) => n + e.total, 0n),
    topAllTime: board, topSeason: board, lifetimeOf: burned ? unit(120) : unit(20), seasonTotalOf: burned ? unit(120) : unit(20),
    decimals: 18, symbol: 'PYRE', balanceOf: burned ? unit(900) : unit(1000), allowance: stage === 'approved' ? unit(100) : 0n,
    approve: true, burn: undefined, sweep: undefined };
  const map = {};
  for (const [name, result] of Object.entries(values)) {
    const abi = appAbi.some(a => a.type === 'function' && a.name === name) ? appAbi : tokenAbi;
    const entry = abi.find(a => a.type === 'function' && a.name === name);
    const args = entry.inputs.map(input => input.type === 'address' ? account : 0n);
    const selector = encodeFunctionData({ abi, functionName: name, args }).slice(0, 10);
    map[selector] = encodeFunctionResult({ abi, functionName: name, result });
  }
  map[encodeFunctionData({ abi: tokenAbi, functionName: 'balanceOf', args: [app.address] })] = encodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', result: stage === 'swept' ? 0n : unit(3) });
  calls[stage] = map;
}
const log = (entry, i, amount = entry.total) => ({ address: app.address, blockHash: hash, blockNumber: toHex(blockNumber),
  transactionHash: txHash, transactionIndex: '0x0', logIndex: toHex(i), removed: false,
  topics: encodeEventTopics({ abi: appAbi, eventName: 'Burned', args: { account: entry.account, season: 0n } }),
  data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [amount, entry.total]) });
const logs = initial.map((e, i) => log(e, i));
const fixture = { manifest, app: app.address, token: token.address, account, other, calls, logs,
  burnedLogs: [...logs, log({ account, total: unit(120) }, 12, unit(100))],
  block: { number: toHex(blockNumber), hash, parentHash: hash, timestamp: toHex(1790481900n),
    nonce: '0x0000000000000000', difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x',
    gasLimit: '0x1c9c380', gasUsed: '0x0', miner: zeroAddress, baseFeePerGas: '0x1',
    transactions: [], uncles: [], size: '0x1', logsBloom: '0x' + '00'.repeat(256), receiptsRoot: hash, stateRoot: hash, transactionsRoot: hash, mixHash: hash },
  receipt: { transactionHash: txHash, blockHash: hash, blockNumber: toHex(blockNumber), transactionIndex: '0x0',
    from: account, to: app.address, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', contractAddress: null,
    logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', effectiveGasPrice: '0x1', type: '0x2' },
  selectors: Object.fromEntries(['approve', 'burn', 'sweep'].map(name => {
    const abi = name === 'approve' ? tokenAbi : appAbi;
    const args = name === 'approve' ? [app.address, unit(100)] : name === 'burn' ? [unit(100)] : [];
    return [name, encodeFunctionData({ abi, functionName: name, args })];
  })),
};
const template = readFileSync(root + 'web/tests/browser.template.js', 'utf8');
mkdirSync(root + 'test/scratch', { recursive: true });
writeFileSync(root + 'test/scratch/browser-test.js', template.replace('__FIXTURE__', JSON.stringify(fixture)));
console.log('Prepared test/scratch/browser-test.js for browser_run_code_unsafe (all RPC and wallet writes mocked).');
