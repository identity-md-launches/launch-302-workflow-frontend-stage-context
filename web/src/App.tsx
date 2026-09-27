import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnits, isAddress, type Address, type Hash } from 'viem';
import { loadConfig, type Config } from './config';
import { readRanks, readSnapshot, switchNetwork, transact, type Snapshot } from './chain';
import { errorText, numberText, parseAmount, shortAddress, type Entry, type reconstruct } from './domain';

function Flame() {
  return <svg viewBox="0 0 32 40" aria-hidden="true"><path d="M17 1c2 11-9 11-8 21 0 2 1 4 3 5-1-7 6-9 7-15 3 4 10 11 10 17 0 6-6 10-13 10S3 35 3 28C3 15 15 12 17 1Z" fill="currentColor" /></svg>;
}

function Amount({ value, decimals = 18 }: { value: bigint; decimals?: number }) {
  return <span className="number" title={`${formatUnits(value, decimals)} PYRE`}>{numberText(value, decimals)}</span>;
}

function Board({ title, subtitle, rows, config, account, loading }: {
  title: string; subtitle: string; rows?: Entry[]; config?: Config; account?: Address; loading: boolean;
}) {
  const filled = rows?.filter(row => row.total > 0n) ?? [];
  return <section className="board" aria-label={title}>
    <div className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><span className="tag">Top 10</span></div>
    <table><caption className="sr-only">{title}: wallet rankings by PYRE burned</caption>
      <thead><tr><th scope="col">Rank</th><th scope="col">Wallet</th><th scope="col">PYRE burned</th></tr></thead>
      <tbody>{filled.map((row, index) => <tr key={row.account} className={row.account.toLowerCase() === account?.toLowerCase() ? 'you' : undefined}>
        <td><span className={`rank rank-${index + 1}`}>{String(index + 1).padStart(2, '0')}</span></td>
        <td><a className="wallet-address" href={`${config?.manifest.network.explorer}/address/${row.account}`} target="_blank" rel="noreferrer" aria-label={`View wallet ${row.account} on the explorer`} title={row.account}>{shortAddress(row.account)}</a>{row.account.toLowerCase() === account?.toLowerCase() && <span className="you-label">You</span>}</td>
        <td><Amount value={row.total} /></td>
      </tr>)}</tbody>
    </table>
    {!filled.length && <div className="empty-board"><span className="empty-symbol" aria-hidden="true">↗</span><h3>{loading ? 'Reading the chain…' : rows ? 'A place for the first flame.' : 'The board is unavailable.'}</h3><p>{loading ? 'Fetching the latest contract snapshot.' : rows ? 'Burn PYRE to put your wallet on the board.' : 'Use Refresh data to try the public RPCs again.'}</p></div>}
    {!!filled.length && filled.length < 10 && <p className="board-footer">{10 - filled.length} open {10 - filled.length === 1 ? 'place' : 'places'}. Every burn counts.</p>}
  </section>;
}

export default function App() {
  const [config, setConfig] = useState<Config>();
  const [configError, setConfigError] = useState('');
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [readError, setReadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ranks, setRanks] = useState<ReturnType<typeof reconstruct>>();
  const [rankMessage, setRankMessage] = useState('');
  const [rankBusy, setRankBusy] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [consent, setConsent] = useState(false);
  const [actionError, setActionError] = useState('');
  const [status, setStatus] = useState('');
  const [hash, setHash] = useState<Hash>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [sessionVersion, setSessionVersion] = useState(0);
  const revision = useRef(0);
  const actionLock = useRef(false);
  const refreshLock = useRef(false);
  const session = useRef(0);

  useEffect(() => { let active = true;
    loadConfig().then(value => { if (active) setConfig(value); }).catch(error => { if (active) setConfigError(errorText(error)); });
    return () => { active = false; };
  }, []);

  const resetSession = useCallback(() => {
    session.current++; revision.current++; refreshLock.current = false;
    setSessionVersion(value => value + 1);
    setSnapshot(undefined); setRanks(undefined); setConsent(false); setStatus(''); setHash(undefined); setActionError('');
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const accountsChanged = (...args: unknown[]) => {
      resetSession();
      const next = (args[0] as string[])[0];
      setAccount(next && isAddress(next) ? next : undefined);
    };
    const chainChanged = (...args: unknown[]) => { resetSession(); setWalletChain(Number(args[0])); };
    const disconnected = () => { resetSession(); setAccount(undefined); setWalletChain(undefined); };
    provider.on?.('accountsChanged', accountsChanged); provider.on?.('chainChanged', chainChanged); provider.on?.('disconnect', disconnected);
    return () => { provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged); provider.removeListener?.('disconnect', disconnected); };
  }, [resetSession]);

  const refresh = useCallback(async () => {
    if (!config || refreshLock.current) return;
    refreshLock.current = true;
    const version = ++revision.current;
    const cancelled = () => revision.current !== version;
    setLoading(true); setReadError(''); setRanks(undefined); setRankMessage(''); setRankBusy(false);
    try {
      const next = await readSnapshot(config, account);
      if (cancelled()) return;
      setSnapshot(next); setLoading(false);
      if (account) {
        setRankBusy(true);
        try {
          const result = await readRanks(config, next, cancelled, message => { if (!cancelled()) setRankMessage(message); });
          if (!cancelled()) { setRanks(result); setRankMessage('Ranks calculated from Burned events.'); }
        } catch (error) { if (!cancelled()) setRankMessage(`Rank unavailable. ${errorText(error)}`); }
      }
    } catch (error) { if (!cancelled()) { setReadError(errorText(error)); setSnapshot(undefined); } }
    finally { if (!cancelled()) { setLoading(false); setRankBusy(false); refreshLock.current = false; } }
  }, [config, account, walletChain, sessionVersion]);

  useEffect(() => {
    revision.current++; refreshLock.current = false;
    void refresh();
    const timer = window.setInterval(() => { if (!actionLock.current) void refresh(); }, 30_000);
    return () => { clearInterval(timer); revision.current++; refreshLock.current = false; };
  }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  async function connect() {
    setActionError(''); setWalletBusy(true);
    try {
      if (!window.ethereum) throw Error('No browser wallet found. Open this page in an Ethereum wallet browser or install a browser wallet, then reload.');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const chain = await window.ethereum.request({ method: 'eth_chainId' });
      if (!accounts[0] || !isAddress(accounts[0])) throw Error('No account was shared. Unlock your wallet and try again.');
      resetSession(); setAccount(accounts[0]); setWalletChain(Number(chain));
    } catch (error) { setActionError(errorText(error)); }
    finally { setWalletBusy(false); }
  }

  async function switchChain() {
    if (!config || !window.ethereum) return;
    setWalletBusy(true); setActionError('');
    try { await switchNetwork(window.ethereum, config); resetSession(); setWalletChain(Number(await window.ethereum.request({ method: 'eth_chainId' }))); }
    catch (error) { setActionError(errorText(error)); }
    finally { setWalletBusy(false); }
  }

  let amount = 0n;
  let amountError = '';
  if (amountText) { try { amount = parseAmount(amountText, snapshot?.decimals ?? 18); } catch (error) { amountError = errorText(error); } }
  const wrongChain = !!account && !!config && walletChain !== config.manifest.chainId;
  const walletData = snapshot && account?.toLowerCase() === snapshot.account?.toLowerCase() && !!account ? snapshot : undefined;
  const stale = !!snapshot && now - snapshot.readAt > 90_000;
  const ready = !!walletData && !wrongChain && !stale && !loading && !readError && !busy && !walletBusy;
  const affordable = !!walletData && amount > 0n && amount <= walletData.balance;
  const approved = !!walletData && amount > 0n && walletData.allowance >= amount;
  const rankFor = (rows?: Entry[]) => { const index = rows?.findIndex(row => row.account.toLowerCase() === account?.toLowerCase()); return index === undefined ? '—' : index < 0 ? 'Unranked' : `#${index + 1}`; };
  const endsAt = snapshot ? new Date(Number(snapshot.endsAt) * 1000) : undefined;
  const remaining = snapshot ? Number(snapshot.endsAt - snapshot.timestamp) : 0;
  const seasonTime = `${Math.floor(remaining / 86400)}d ${Math.floor(remaining % 86400 / 3600)}h remaining at snapshot`;

  async function act(kind: 'approve' | 'burn' | 'sweep') {
    if (!ready || !config || !window.ethereum || !account || actionLock.current) return;
    setActionError(''); setHash(undefined);
    if (kind !== 'sweep' && (!affordable || amountError)) { setActionError(amountError || 'Enter a positive amount within your PYRE balance.'); return; }
    if (kind === 'burn' && (!approved || !consent)) return;
    const currentSession = session.current;
    actionLock.current = true; setBusy(true);
    try {
      await transact(config, window.ethereum, account, kind, amount, (text, txHash) => {
        if (session.current === currentSession) { setStatus(text); if (txHash) setHash(txHash); }
      });
      if (session.current === currentSession) { setConsent(false); if (kind === 'burn') setAmountText(''); }
    } catch (error) {
      if (session.current === currentSession) { setActionError(errorText(error)); setStatus(''); }
    } finally {
      actionLock.current = false; setBusy(false);
      if (session.current === currentSession) { revision.current++; refreshLock.current = false; void refresh(); }
    }
  }

  const walletButton = <button className="wallet-button" disabled={walletBusy || busy || !config} onClick={account ? () => { resetSession(); setAccount(undefined); setWalletChain(undefined); } : connect}>
    <span className="wallet-dot" aria-hidden="true" />{walletBusy ? 'Opening wallet…' : account ? `${shortAddress(account)} · Disconnect` : 'Connect wallet'}
  </button>;

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="page-shell">
      <header><a className="brand" href="#main" aria-label="Pyre home"><Flame /><span>pyre<span className="brand-period">.</span></span></a>
        <div className="header-actions"><span className="network-label">{config?.manifest.network.name ?? 'Testnet'} <span>testnet</span></span>{walletButton}</div>
      </header>
      <main id="main">
        <div className="hero-grid">
          <section className="hero" aria-labelledby="headline"><p className="eyebrow"><span />The burn leaderboard</p>
            <h1 id="headline">Leave a mark.<br /><span>Burn PYRE.</span></h1>
            <p className="intro">A permanent burn. A place on the board.<br className="desktop-break" /> Every PYRE counts toward your all-time total and a fresh seven-day season.</p>
            <div className="hero-stats"><div><span className="stat-label">Total PYRE burned</span><strong>{snapshot ? <Amount value={snapshot.total} /> : '—'}</strong></div>
              <div><span className="stat-label">Current season</span><strong>{snapshot ? String(snapshot.season + 1n).padStart(2, '0') : '—'}</strong><span className="small">7 days. A new start.</span></div></div>
            <p className="testnet-note">Built on {config?.manifest.network.name ?? 'the deployment network'}. Test tokens only.</p>
          </section>
          <section className="burn-card" aria-labelledby="burn-heading">
            <div className="section-heading"><h2 id="burn-heading">Make your burn</h2><Flame /></div>
            <p className="muted">Approve an amount, then send it to the burn address. This cannot be undone.</p>
            <div className="balance-row"><span>PYRE balance</span><strong data-testid="balance">{walletData ? <Amount value={walletData.balance} /> : '—'}</strong></div>
            <label className="input-label" htmlFor="amount">Amount to burn</label>
            <div className="amount-input"><input id="amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amountText} disabled={busy} aria-invalid={!!amountError || (amount > 0n && !!walletData && !affordable)} aria-describedby="amount-help" onChange={event => { setAmountText(event.target.value); setConsent(false); setActionError(''); }} /><span>PYRE</span><button className="max-button" disabled={!ready} onClick={() => { if (walletData) setAmountText(formatUnits(walletData.balance, walletData.decimals)); setConsent(false); }}>Max</button></div>
            <p id="amount-help" className={amountError || (amount > 0n && walletData && !affordable) ? 'field-error' : 'small'}>{amountError || (amount > 0n && walletData && !affordable ? 'This amount exceeds your PYRE balance.' : 'Only the amount you choose will be approved.')}</p>
            <div className="allowance-row"><span>Approved for this contract</span><span data-testid="allowance">{walletData ? <><Amount value={walletData.allowance} /> PYRE</> : '—'}</span></div>
            {!account && <p className="prerequisite">Connect a wallet to read your balance and start.</p>}
            {wrongChain && <div className="network-warning"><p>Your wallet is on another network.</p><button onClick={switchChain} disabled={walletBusy || busy}>Switch to {config?.manifest.network.name}</button></div>}
            {stale && <p className="field-error">Data is out of date. Refresh before continuing.</p>}
            <div className="steps"><button className={!approved ? 'primary' : 'secondary'} disabled={!ready || !affordable || !!amountError || approved} onClick={() => void act('approve')}><span className="step-number">1</span>{approved ? 'Amount approved' : 'Approve PYRE'}<span aria-hidden="true">{approved ? '✓' : '↗'}</span></button>
              <label className="confirmation"><input type="checkbox" checked={consent} disabled={!ready || !approved || !affordable} onChange={event => setConsent(event.target.checked)} /><span>I understand that burning {amount > 0n ? `${formatUnits(amount, snapshot?.decimals ?? 18)} PYRE` : 'PYRE'} is permanent.</span></label>
              <button className={approved ? 'primary' : 'secondary'} disabled={!ready || !affordable || !approved || !consent} onClick={() => void act('burn')}><span className="step-number">2</span>Burn PYRE<span aria-hidden="true">↗</span></button></div>
            <div className="transaction-status" role="status">{status}</div>
            <div className="error-message" role="alert">{actionError}</div>
            {hash && <a className="transaction-link" href={`${config?.manifest.network.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction on explorer ↗</a>}
            <details className="get-pyre"><summary>Where do I get PYRE?</summary><p>Get PYRE by swapping {config?.manifest.network.name ?? 'Sepolia'} ETH in the factory-seeded launch pool. Use the PYRE token address below in a compatible Uniswap v4 interface. Swaps happen outside this page.</p><p>Keep some test ETH for transaction fees.</p></details>
          </section>
        </div>

        <section className="your-stats" aria-labelledby="your-heading"><div><h2 id="your-heading">Your footprint</h2><p>{account ? <a href={`${config?.manifest.network.explorer}/address/${account}`} target="_blank" rel="noreferrer" title={account}>{shortAddress(account)} ↗</a> : 'Connect to see your progress.'}</p></div>
          <div><span className="stat-label">All-time burned</span><strong>{walletData ? <><Amount value={walletData.lifetime} /> <small>PYRE</small></> : '—'}</strong></div>
          <div><span className="stat-label">All-time rank</span><strong data-testid="all-rank">{rankFor(ranks?.all)}</strong></div>
          <div><span className="stat-label">Season burned</span><strong>{walletData ? <><Amount value={walletData.seasonTotal} /> <small>PYRE</small></> : '—'}</strong></div>
          <div><span className="stat-label">Season rank</span><strong data-testid="season-rank">{rankFor(ranks?.current)}</strong></div>
        </section>
        {account && <p className="rank-status" role="status">{rankMessage}</p>}
        <div className="data-toolbar"><p>{snapshot ? <>Snapshot at block <a href={`${config?.manifest.network.explorer}/block/${snapshot.blockNumber}`} target="_blank" rel="noreferrer">{snapshot.blockNumber.toLocaleString()}</a>{stale ? ' · Out of date' : ' · Auto-refreshes every 30s'}</> : loading ? 'Verifying deployment and reading live state…' : 'Live state is unavailable.'}</p><button className="text-button" disabled={!config || loading || rankBusy || busy} onClick={() => void refresh()}>{loading || rankBusy ? 'Refreshing…' : 'Refresh data'} <span aria-hidden="true">↻</span></button></div>
        {(readError || configError) && <div className="read-error" role="alert"><strong>Unable to verify live state.</strong><p>{configError || readError}</p>{configError && <button onClick={() => window.location.reload()}>Reload configuration</button>}</div>}
        <div className="boards-grid"><Board title="All-time leaders" subtitle="A lasting record. No resets." rows={snapshot?.all} config={config} account={account} loading={loading} />
          <Board title={snapshot ? `Season ${String(snapshot.season + 1n).padStart(2, '0')}` : 'Current season'} subtitle={snapshot ? seasonTime : 'A fresh board every seven days.'} rows={snapshot?.current} config={config} account={account} loading={loading} /></div>
        <div className="board-notes"><p>Equal totals? The first wallet to reach that total ranks higher.</p>{endsAt && <p>Season ends <time dateTime={endsAt.toISOString()}>{endsAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>.</p>}</div>
        <details className="protocol-details"><summary>How it works & contract details</summary><div className="details-grid"><div><h3>Burns are permanent</h3><p>PYRE moves directly from your wallet to the dead address. Burns increase your all-time total and the current season total. Past seasons stay frozen. Rank uses on-chain Burned events; top tens come from contract views.</p><p>No owner. No admin. No rewards or payouts from this app.</p>
          {snapshot && <p>Burn address <a className="full-address" href={`${config?.manifest.network.explorer}/address/${snapshot.dead}`} target="_blank" rel="noreferrer">{snapshot.dead}</a></p>}
          {config?.manifest.contracts.map(contract => <p key={contract.name}>{contract.name}<a className="full-address" href={`${config.manifest.network.explorer}/address/${contract.address}`} target="_blank" rel="noreferrer">{contract.address}</a></p>)}</div>
          <div><h3>Sweep stray PYRE</h3><p>PYRE sent directly to the contract earns no ranking credit. Anyone can forward it to the dead address. A sweep burns that balance and gives no credit to you.</p><p>Contract balance: {snapshot ? <><Amount value={snapshot.stranded} /> PYRE</> : 'unavailable'}</p><button disabled={!ready || !snapshot || snapshot.stranded === 0n} onClick={() => { if (window.confirm('Permanently send all stray PYRE held by the contract to the dead address? This gives no ranking credit.')) void act('sweep'); }}>Sweep stray PYRE</button><p className="small">Your wallet pays only the network fee. No token approval is needed.</p></div></div></details>
      </main>
      <footer><span>pyre. <span>A little less supply. A lasting record.</span></span><a href="./imd-deployment.json">Deployment record ↗</a></footer>
    </div>
  </>;
}
