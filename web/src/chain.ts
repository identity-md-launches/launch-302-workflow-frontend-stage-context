import { createWalletClient, custom, type Address, type EIP1193Provider, type Hash } from 'viem';
import type { Config } from './config';
import { reconstruct, type BurnEvent, type Entry } from './domain';

export type Provider = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
declare global { interface Window { ethereum?: Provider } }

export async function verifyDeployment(config: Config, blockNumber?: bigint) {
  const { client, manifest, app, token } = config;
  const [id, appCode, tokenCode, boundToken] = await Promise.all([
    client.getChainId(), client.getCode({ address: app.address, blockNumber }),
    client.getCode({ address: token.address, blockNumber }),
    client.readContract({ ...app, functionName: 'token', blockNumber }),
  ]);
  if (id !== manifest.chainId) throw Error('The RPC returned the wrong network. Retry the connection.');
  if (!appCode || appCode === '0x' || !tokenCode || tokenCode === '0x') throw Error('Deployed contract code is missing. Transactions are disabled.');
  if (String(boundToken).toLowerCase() !== token.address.toLowerCase()) throw Error('The leaderboard token differs from the attested PYRE deployment.');
  return boundToken as Address;
}

export async function readSnapshot(config: Config, account?: Address) {
  const { client, app, token } = config;
  const block = await client.getBlock();
  const blockNumber = block.number;
  const tokenAddress = await verifyDeployment(config, blockNumber);
  const appRead = (functionName: string, args?: unknown[]) => client.readContract({ ...app, functionName, args, blockNumber });
  const tokenRead = (functionName: string, args?: unknown[]) => client.readContract({ ...token, address: tokenAddress, functionName, args, blockNumber });
  const season = await appRead('currentSeason') as bigint;
  const [total, all, current, deployedAt, duration, decimals, symbol, balance, allowance, lifetime, seasonTotal, stranded, dead] = await Promise.all([
    appRead('totalBurned'), appRead('topAllTime'), appRead('topSeason', [season]),
    appRead('deployTimestamp'), appRead('SEASON_DURATION'), tokenRead('decimals'), tokenRead('symbol'),
    account ? tokenRead('balanceOf', [account]) : 0n,
    account ? tokenRead('allowance', [account, app.address]) : 0n,
    account ? appRead('lifetimeOf', [account]) : 0n,
    account ? appRead('seasonTotalOf', [season, account]) : 0n,
    tokenRead('balanceOf', [app.address]), appRead('DEAD'),
  ]);
  if (Number(decimals) !== 18 || symbol !== 'PYRE') throw Error('Token metadata does not match PYRE.');
  return { blockNumber, blockHash: block.hash, timestamp: block.timestamp, account, tokenAddress,
    season, total: total as bigint, all: all as Entry[], current: current as Entry[],
    endsAt: (deployedAt as bigint) + (season + 1n) * (duration as bigint), decimals: Number(decimals),
    balance: balance as bigint, allowance: allowance as bigint, lifetime: lifetime as bigint,
    seasonTotal: seasonTotal as bigint, stranded: stranded as bigint, dead: dead as Address, readAt: Date.now() };
}
export type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;

export async function readRanks(config: Config, snapshot: Snapshot, isCancelled: () => boolean, progress: (message: string) => void) {
  const { client, app, manifest } = config;
  const events: BurnEvent[] = [];
  let fromBlock = BigInt(manifest.deploymentBlock);
  let span = 5000n;
  while (fromBlock <= snapshot.blockNumber) {
    if (isCancelled()) throw Error('History refresh cancelled.');
    const toBlock = fromBlock + span - 1n < snapshot.blockNumber ? fromBlock + span - 1n : snapshot.blockNumber;
    progress(`Reading burn events: block ${toBlock.toLocaleString()} of ${snapshot.blockNumber.toLocaleString()}`);
    try {
      const logs = await client.getContractEvents({ ...app, eventName: 'Burned', fromBlock, toBlock, strict: true });
      for (const log of logs) {
        if (log.removed) continue;
        const args = (log as unknown as { args: Pick<BurnEvent, 'account' | 'amount' | 'season' | 'lifetimeTotal'> }).args;
        events.push({ ...args, blockNumber: log.blockNumber, transactionIndex: log.transactionIndex, logIndex: log.logIndex });
      }
      fromBlock = toBlock + 1n;
    } catch (error) {
      if (span <= 100n) throw error;
      span /= 2n;
    }
  }
  const ranks = reconstruct(events, snapshot.season);
  if (ranks.all.reduce((total, row) => total + row.total, 0n) !== snapshot.total) throw Error('Event history is incomplete. Retry to calculate your rank.');
  const reference = await client.getBlock({ blockNumber: snapshot.blockNumber });
  if (reference.hash !== snapshot.blockHash) throw Error('The chain reorganized during this read. Refresh to recalculate ranks.');
  for (const [view, computed] of [[snapshot.all, ranks.all], [snapshot.current, ranks.current]]) {
    const occupied = view.filter(row => row.total > 0n);
    if (occupied.some((row, index) => row.account.toLowerCase() !== computed[index]?.account.toLowerCase() || row.total !== computed[index]?.total)) {
      throw Error('Event history differs from the contract board. Refresh to recalculate ranks.');
    }
  }
  return ranks;
}

export async function switchNetwork(provider: Provider, config: Config) {
  const params: [{ chainId: `0x${string}` }] = [{ chainId: config.manifest.walletAddChain.chainId }];
  try { await provider.request({ method: 'wallet_switchEthereumChain', params }); }
  catch (error) {
    const err = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
    if (err.code !== 4902 && err.data?.originalError?.code !== 4902 && !/unknown chain|unrecognized chain|chain.*not.*added/i.test(err.message ?? '')) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [config.manifest.walletAddChain] });
    await provider.request({ method: 'wallet_switchEthereumChain', params });
  }
}

export async function transact(config: Config, provider: Provider, account: Address, kind: 'approve' | 'burn' | 'sweep', amount: bigint, status: (text: string, hash?: Hash) => void) {
  const assertWallet = async () => {
    const [chain, accounts] = await Promise.all([
      provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' }),
    ]);
    if (Number(chain) !== config.manifest.chainId || accounts[0]?.toLowerCase() !== account.toLowerCase()) throw Error('Your wallet or network changed. Reconnect and review the action.');
  };
  status('Checking your wallet and simulating the transaction…');
  await assertWallet();
  const tokenAddress = await verifyDeployment(config);
  const binding = kind === 'approve' ? { ...config.token, address: tokenAddress } : config.app;
  const args = kind === 'approve' ? [config.app.address, amount] : kind === 'burn' ? [amount] : [];
  const { request } = await config.client.simulateContract({ ...binding, functionName: kind, args, account });
  await assertWallet();
  status(`Confirm ${kind === 'approve' ? 'the exact PYRE allowance' : kind === 'burn' ? 'the permanent burn' : 'the sweep'} in your wallet.`);
  const wallet = createWalletClient({ chain: config.chain, transport: custom(provider) });
  const hash = await wallet.writeContract(request);
  status('Transaction submitted. Waiting for confirmation…', hash);
  const receipt = await config.client.waitForTransactionReceipt({ hash, timeout: 120_000, onReplaced: replacement => {
    status('Transaction replaced. Waiting for confirmation…', replacement.transaction.hash);
  } });
  if (receipt.status !== 'success') throw Error('Transaction reverted. No action was completed. Refresh and review the amount.');
  // A wallet cancellation is a successful zero-value replacement, not a successful contract call.
  if (receipt.transactionHash !== hash) {
    const replacement = await config.client.getTransaction({ hash: receipt.transactionHash });
    const original = await config.client.getTransaction({ hash });
    if (replacement.input !== original.input || replacement.to?.toLowerCase() !== original.to?.toLowerCase()) throw Error('Transaction was cancelled or replaced with another action. Check the explorer.');
  }
  status(`${kind === 'approve' ? 'Approval' : kind === 'burn' ? 'Burn' : 'Sweep'} confirmed.`, receipt.transactionHash);
}
