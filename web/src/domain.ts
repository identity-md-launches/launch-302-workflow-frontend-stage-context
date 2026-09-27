import { formatUnits, maxUint256, parseUnits, type Address } from 'viem';

export type BurnEvent = { account: Address; amount: bigint; season: bigint; lifetimeTotal: bigint;
  blockNumber: bigint; transactionIndex: number; logIndex: number };
export type Entry = { account: Address; total: bigint };

export function parseAmount(text: string, decimals: number): bigint {
  if (!/^(?:\d+)(?:\.\d+)?$/.test(text) || (text.split('.')[1]?.length ?? 0) > decimals) {
    throw Error(`Enter a positive PYRE amount with at most ${decimals} decimal places.`);
  }
  const amount = parseUnits(text, decimals);
  if (amount <= 0n || amount > maxUint256) throw Error('Enter a positive PYRE amount within the token limit.');
  return amount;
}

export function numberText(value: bigint, decimals: number): string {
  const exact = formatUnits(value, decimals);
  const [integer, fraction] = exact.split('.');
  const main = BigInt(integer).toLocaleString('en-US');
  if (value > 0n && value < parseUnits('0.0001', decimals)) return '<0.0001';
  return main + (fraction ? `.${fraction.slice(0, 4).replace(/0+$/, '')}`.replace(/\.$/, '') : '');
}
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function reconstruct(events: BurnEvent[], season: bigint) {
  const all = new Map<string, Entry & { reached: number }>();
  const current = new Map<string, Entry & { reached: number }>();
  const sorted = [...events].sort((a, b) => a.blockNumber !== b.blockNumber
    ? a.blockNumber < b.blockNumber ? -1 : 1
    : a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex);
  const seen = new Set<string>();
  sorted.forEach((event, index) => {
    const id = `${event.blockNumber}:${event.transactionIndex}:${event.logIndex}`;
    if (seen.has(id)) return;
    seen.add(id);
    const key = event.account.toLowerCase();
    all.set(key, { account: event.account, total: event.lifetimeTotal, reached: index });
    if (event.season === season) current.set(key, { account: event.account,
      total: (current.get(key)?.total ?? 0n) + event.amount, reached: index });
  });
  const order = (map: typeof all) => [...map.values()].filter(e => e.total > 0n).sort((a, b) =>
    a.total === b.total ? a.reached - b.reached : a.total > b.total ? -1 : 1);
  return { all: order(all), current: order(current) };
}

export function errorText(error: unknown): string {
  const err = error as { code?: number; shortMessage?: string; message?: string; cause?: unknown };
  if (err?.code === 4001 || /rejected|denied/i.test(err?.message ?? '')) return 'Request declined in your wallet. You can try again when ready.';
  return (err?.shortMessage ?? err?.message ?? 'The request failed. Check your connection and try again.').slice(0, 350);
}
