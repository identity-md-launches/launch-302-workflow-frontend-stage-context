import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { keccak256, stringToHex } from 'viem';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(root, 'dist');
const handoff = JSON.parse(readFileSync(resolve(root, 'web/deployment/handoff.json')));
const network = JSON.parse(readFileSync(resolve(root, 'web/deployment/network.json')));
const check = process.argv.includes('--check');
const notices = readFileSync(resolve(root, 'web/THIRD_PARTY_NOTICES.txt'));
if (check) {
  if (!readFileSync(resolve(dist, 'THIRD_PARTY_NOTICES.txt')).equals(notices)) throw Error('License notices differ');
} else writeFileSync(resolve(dist, 'THIRD_PARTY_NOTICES.txt'), notices);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);
if (handoff.chainId !== network.network.chainId || Number(network.walletAddChain.chainId) !== handoff.chainId) throw Error('Network mismatch');
const contracts = handoff.contracts.map(({ name, address, abiHash, blockNumber }) => {
  if (!/^[A-Za-z0-9_]+$/.test(name) || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw Error('Invalid contract');
  const raw = execFileSync('git', ['show', `${handoff.sourceCommit}:docs/abi/${name}.json`], { cwd: root });
  const abi = JSON.parse(raw);
  const actual = keccak256(stringToHex(canonical(abi))).slice(2);
  if (!Array.isArray(abi) || actual !== abiHash) throw Error(`ABI hash mismatch: ${name}: ${actual}`);
  const abiPath = `abi/${name}.json`;
  if (check) {
    if (!readFileSync(resolve(dist, abiPath)).equals(raw)) throw Error(`Exported ABI differs: ${name}`);
  } else {
    mkdirSync(resolve(dist, 'abi'), { recursive: true });
    writeFileSync(resolve(dist, abiPath), raw);
  }
  console.log(`Verified ${name}: ${abiHash} at ${handoff.sourceCommit} (block ${blockNumber})`);
  return { name, address, abiHash, abiPath };
});
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  if (e.isSymbolicLink()) throw Error('Symlinks are not export assets');
  const path = resolve(dir, e.name);
  return e.isDirectory() ? files(path) : [path];
});
const assets = files(dist).filter(p => relative(dist, p) !== 'imd-deployment.json').sort().map(p => {
  if (statSync(p).size > 8388608) throw Error('Asset exceeds 8 MiB');
  return { path: relative(dist, p), sha256: createHash('sha256').update(readFileSync(p)).digest('hex') };
});
if (assets.length > 128) throw Error('Too many assets');
const manifest = {
  version: 1, launchId: handoff.launchId, chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash,
  contracts, assets, network: network.network, walletAddChain: network.walletAddChain,
  deploymentBlock: Math.min(...handoff.contracts.map(c => c.blockNumber)),
};
const bytes = JSON.stringify(manifest, null, 2) + '\n';
const target = resolve(dist, 'imd-deployment.json');
if (check) {
  if (readFileSync(target, 'utf8') !== bytes) throw Error('Manifest or export inventory differs');
} else writeFileSync(target, bytes);
const total = files(dist).reduce((n, p) => n + statSync(p).size, 0);
if (total > 8 * 1024 * 1024) throw Error('Export exceeds submission budget');
console.log(`${check ? 'Checked' : 'Exported'} ${assets.length} assets; ${total} bytes including manifest.`);
