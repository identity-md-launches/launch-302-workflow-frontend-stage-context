async (page) => {
  const fixture = __FIXTURE__;
  const results = [];
  const errors = [];
  const requests = [];
  const assert = (condition, message) => { if (!condition) throw Error(message); results.push(message); };
  await page.unrouteAll({ behavior: 'wait' });
  await page.addInitScript(({ fixture }) => {
    const listeners = {};
    window.mock = { stage: 'initial', chain: '0x1', added: false, account: fixture.account,
      rejectConnect: false, rejectSend: false, simFail: false, noCode: false, badToken: false,
      logFail: false, rpcFail: false, sent: [], walletCalls: [], pending: false };
    window.mock.emit = (event, value) => (listeners[event] || []).forEach(fn => fn(value));
    window.ethereum = {
      on: (event, fn) => { (listeners[event] ||= []).push(fn); },
      removeListener: (event, fn) => { listeners[event] = (listeners[event] || []).filter(item => item !== fn); },
      request: async request => {
        const state = window.mock;
        state.walletCalls.push(request);
        if (request.method === 'eth_requestAccounts' && state.rejectConnect) throw { code: 4001, message: 'User rejected request' };
        if (request.method === 'eth_requestAccounts' || request.method === 'eth_accounts') return [state.account];
        if (request.method === 'eth_chainId') return state.chain;
        if (request.method === 'wallet_switchEthereumChain') {
          if (!state.added) throw { code: 4902, message: 'Unknown chain' };
          state.chain = fixture.manifest.walletAddChain.chainId;
          state.emit('chainChanged', state.chain); return null;
        }
        if (request.method === 'wallet_addEthereumChain') { state.added = true; return null; }
        if (request.method === 'eth_sendTransaction') {
          if (state.rejectSend) throw { code: 4001, message: 'User rejected request' };
          const tx = request.params[0]; state.sent.push(tx);
          if (tx.data === fixture.selectors.approve) state.stage = 'approved';
          else if (tx.data === fixture.selectors.burn) state.stage = 'burned';
          else if (tx.data === fixture.selectors.sweep) state.stage = 'swept';
          else throw Error('Unexpected transaction data');
          return fixture.receipt.transactionHash;
        }
        throw Error('Unexpected wallet method: ' + request.method);
      }
    };
  }, { fixture });
  await page.route(url => fixture.manifest.network.rpcUrls.some(rpc => url.href.startsWith(rpc)), async route => {
    const state = await page.evaluate(() => ({ ...window.mock, emit: undefined }));
    const request = route.request().postDataJSON();
    const respond = request => {
      requests.push(request);
      if (state.rpcFail) return { id: request.id, jsonrpc: '2.0', error: { code: -32000, message: 'Fixture RPC unavailable' } };
      let result;
      switch (request.method) {
        case 'eth_chainId': result = fixture.manifest.walletAddChain.chainId; break;
        case 'eth_blockNumber': result = fixture.block.number; break;
        case 'eth_getBlockByNumber': result = fixture.block; break;
        case 'eth_getCode': result = state.noCode ? '0x' : '0x60006000'; break;
        case 'eth_call': {
          const data = request.params[0].data;
          if (state.simFail && data.startsWith(fixture.selectors.burn.slice(0, 10))) return { id: request.id, jsonrpc: '2.0', error: { code: 3, message: 'execution reverted: Fixture burn failure', data: '0x' } };
          result = fixture.calls[state.stage][data] ?? fixture.calls[state.stage][data.slice(0, 10)];
          if (!result) throw Error('Unexpected call: ' + data);
          if (state.badToken && data === '0xfc0c546a') result = '0x' + '0'.repeat(24) + fixture.other.slice(2);
          break;
        }
        case 'eth_getLogs':
          if (state.logFail) return { id: request.id, jsonrpc: '2.0', error: { code: -32000, message: 'Fixture history unavailable' } };
          result = ['burned', 'swept'].includes(state.stage) ? fixture.burnedLogs : fixture.logs; break;
        case 'eth_getTransactionReceipt': result = state.pending ? null : fixture.receipt; break;
        default: throw Error('Unexpected RPC: ' + request.method);
      }
      return { id: request.id, jsonrpc: '2.0', result };
    };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(request) ? request.map(respond) : respond(request)) });
  });
  page.on('pageerror', error => errors.push(error.message));
  const approve = page.getByRole('button', { name: /Approve PYRE|Amount approved/ });
  const burn = page.getByRole('button', { name: '2 Burn PYRE' });
  const connect = page.getByRole('button', { name: 'Connect wallet' });
  const refresh = async () => { await page.getByRole('button', { name: 'Refresh data' }).click(); await page.waitForFunction(() => !document.querySelector('.data-toolbar button').disabled); };
  await page.goto('http://localhost:5180/preview/');
  await page.waitForFunction(() => document.body.innerText.includes('Snapshot at block'));
  assert(await approve.isDisabled() && await burn.isDisabled(), 'Disconnected actions are disabled');
  await page.evaluate(() => window.mock.rejectConnect = true);
  await connect.click(); await page.getByText('Request declined in your wallet.', { exact: false }).waitFor();
  assert(await burn.isDisabled(), 'Wallet connection rejection is visible and recoverable');
  await page.evaluate(() => window.mock.rejectConnect = false);
  await connect.click(); await page.getByRole('button', { name: 'Switch to Sepolia' }).waitFor();
  assert(await approve.isDisabled(), 'Wrong chain gates all token actions');
  await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid=all-rank]').textContent === '#11');
  const walletCalls = await page.evaluate(() => window.mock.walletCalls);
  assert(JSON.stringify(walletCalls.find(r => r.method === 'wallet_addEthereumChain').params[0]) === JSON.stringify(fixture.manifest.walletAddChain), 'Unknown chain uses exact handoff add-chain parameters');
  assert(walletCalls.filter(r => r.method === 'wallet_switchEthereumChain').length === 2, 'Switch is retried after adding the chain');
  assert((await page.getByTestId('balance').innerText()) === '1,000', 'Connected PYRE balance comes from RPC');
  assert((await page.getByTestId('allowance').innerText()) === '0 PYRE', 'Allowance is visible before payment');
  assert((await page.getByTestId('season-rank').innerText()) === '#11', 'Event-derived ranks include accounts outside the top ten');
  await page.getByLabel('Amount to burn').fill('0');
  assert(await approve.isDisabled(), 'Zero burn rejected');
  await page.getByLabel('Amount to burn').fill('1000.000000000000000001');
  assert(await approve.isDisabled(), 'Insufficient balance rejected without floating-point rounding');
  await page.getByLabel('Amount to burn').fill('1.0000000000000000001');
  assert(await page.getByLabel('Amount to burn').getAttribute('aria-invalid') === 'true', 'Excess precision is associated with the invalid field');
  await page.getByRole('button', { name: 'Max', exact: true }).click();
  assert(await page.getByLabel('Amount to burn').inputValue() === '1000', 'Max uses the exact token balance');
  await page.getByLabel('Amount to burn').fill('100');
  await page.evaluate(() => window.mock.rejectSend = true);
  await approve.click(); await page.getByText('Request declined in your wallet.', { exact: false }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.steps button').disabled);
  assert(await burn.isDisabled(), 'Rejected approval cannot enable a burn');
  await page.evaluate(() => window.mock.rejectSend = false);
  await approve.click(); await page.getByText('Approval confirmed.', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid=allowance]').textContent === '100 PYRE');
  assert(await burn.isDisabled(), 'Approval still requires explicit permanent-burn confirmation');
  await page.getByRole('checkbox').check();
  await page.evaluate(() => window.mock.simFail = true);
  await burn.click(); await page.getByText(/reverted|Fixture burn failure/).first().waitFor();
  assert((await page.evaluate(() => window.mock.sent)).length === 1, 'Simulation failure never requests a wallet transaction');
  await page.evaluate(() => window.mock.simFail = false);
  await page.waitForFunction(() => !document.querySelector('.data-toolbar button').disabled);
  await page.getByRole('checkbox').check();
  await burn.click(); await page.getByText('Burn confirmed.', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid=all-rank]').textContent === '#2');
  const sent = await page.evaluate(() => window.mock.sent);
  assert(sent[0].to.toLowerCase() === fixture.token.toLowerCase() && sent[0].data === fixture.selectors.approve, 'Approval targets PYRE and grants exactly 100 PYRE to BurnLeaderboard');
  assert(sent[1].to.toLowerCase() === fixture.app.toLowerCase() && sent[1].data === fixture.selectors.burn && !sent[1].value, 'Burn targets attested contract with correct amount and no ETH');
  assert((await page.getByTestId('balance').innerText()) === '900', 'Confirmed burn refreshes balance and event rank');
  await page.getByText('How it works & contract details', { exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Sweep stray PYRE' }).click();
  await page.getByText('Sweep confirmed.', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.details-grid button').disabled);
  assert((await page.evaluate(() => window.mock.sent)).length === 3, 'Sweep confirms, sends no approval, refreshes contract balance');
  await page.getByText('How it works & contract details', { exact: true }).click();
  await page.evaluate(() => { window.mock.account = '0x000000000000000000000000000000000000004d'; window.mock.emit('accountsChanged', [window.mock.account]); });
  assert(await burn.isDisabled(), 'Account changes clear consent and disable pending actions');
  await page.waitForFunction(() => document.querySelector('[data-testid=all-rank]').textContent === 'Unranked');
  await page.evaluate(() => { window.mock.noCode = true; }); await refresh();
  await page.getByText('Deployed contract code is missing.', { exact: false }).waitFor();
  assert(await approve.isDisabled(), 'Missing deployed code disables all writes');
  await page.evaluate(() => { window.mock.noCode = false; window.mock.badToken = true; }); await refresh();
  await page.getByText('The leaderboard token differs', { exact: false }).waitFor();
  assert(await approve.isDisabled(), 'Mismatched token binding disables all writes');
  await page.evaluate(() => { window.mock.badToken = false; window.mock.logFail = true; }); await refresh();
  await page.getByText('Rank unavailable.', { exact: false }).waitFor();
  assert(await page.getByTestId('all-rank').innerText() === '—', 'Failed history never presents a fabricated rank');
  await page.evaluate(() => { window.mock.logFail = false; window.mock.account = '0x000000000000000000000000000000000000000b'; window.mock.emit('accountsChanged', [window.mock.account]); });
  await page.waitForFunction(() => document.querySelector('[data-testid=all-rank]').textContent === '#2');
  for (const width of [1280, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% text enlargement reflows without page overflow');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(await page.locator('.wallet-button').evaluate(el => getComputedStyle(el).transitionDuration) === '0s', 'Reduced motion disables button transitions');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByLabel('Amount to burn').fill('100');
  await page.locator('.wallet-button').focus(); await page.keyboard.press('Tab');
  assert(await page.getByLabel('Amount to burn').evaluate(el => el === document.activeElement), 'Keyboard order reaches amount after wallet control');
  assert(errors.length === 0, 'No uncaught browser JavaScript errors');
  assert(requests.filter(r => r.method === 'eth_call' && !r.params[0].account).length > 0, 'Production app performs contract RPC reads');
  const report = { results, errors, transactions: await page.evaluate(() => window.mock.sent), rpcRequests: requests.length };
  await page.evaluate(report => window.__validation = report, report);
  return report;
}
