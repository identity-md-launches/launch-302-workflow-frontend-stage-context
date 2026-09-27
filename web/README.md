# Pyre frontend

One static React/TypeScript page for the deployed PYRE BurnLeaderboard. The publisher can host the contents of `dist/` as plain files, including from a gateway subpath. There is no backend, indexer, private RPC credential, WalletConnect project ID, or runtime CDN dependency.

## Install, build and preview

Use Node 22.12+ (validated on Node 24.21.0 and npm 11.19.0).

```sh
cd web
npm ci
npm run build
npm run preview
```

Vite preview serves the root export. For the same subpath used in validation:

```sh
node scripts/serve.mjs
# http://localhost:5180/preview/
```

For development, run `npm run dev` after the first build. Vite's development middleware serves the generated deployment JSON and ABI files from `dist/`; React source updates use Vite's normal hot reload. Rebuild after changing deployment inputs. Production hosting needs only `dist/`, not Node or `web/`.

`npm run build` typechecks, builds with relative `base: './'`, copies implementation ABIs, and emits the deployment manifest **last**. No root build settings or contracts are modified. Do not edit generated files manually. `npm run check:export` checks exact ABI bytes, canonical ABI hashes, all asset SHA-256 hashes, copied configuration, asset count, and size limits.

## Deployment source of truth

`deployment/handoff.json` and `deployment/network.json` are preserved copies of the supplied handoff, not a second runtime map. The export script reads ABI arrays using `git show <sourceCommit>:docs/abi/<Contract>.json`. The pinned source commit must be present in Git history to rebuild. The implementation ABI exports already exist there; their canonical Keccak-256 hashes match the attested handoff. Canonicalization recursively sorts object keys, preserves array order, serializes without whitespace, and hashes UTF-8 bytes. Hashes omit `0x`.

At runtime, `src/config.ts` fetches only `./imd-deployment.json` for deployment and network configuration, fetches its relative `abiPath` files, verifies ABI hashes, and constructs the viem client. No address, chain ID, RPC URL, or implementation ABI is duplicated in application source. The unchanged network block includes the vetted Uniswap v4 addresses. The manifest also retains the exact `walletAddChain` parameters and the handoff's deployment block for event reads. These two additional fields avoid another runtime configuration file.

The export inventories every file except the manifest itself, including local license notices. After changing any exported byte, run the build again. Keep `dist/` tracked; the publisher does not rebuild it. No IPFS CID or published URL is needed for this worker delivery.

## Wallet and transaction behavior

- Browser wallets exposing EIP-1193 through `window.ethereum` are supported. Use a wallet browser on mobile. Multiple-wallet discovery and WalletConnect are not implemented; no public project ID was supplied.
- Public RPC fallback follows the handoff's URL order. Reads work while disconnected. The wallet signs; it is never used for private keys, deployment, or unattended transactions.
- A wrong-chain wallet sees one Switch to Sepolia control. Error 4902/unknown-chain triggers the supplied `wallet_addEthereumChain` parameters, then another switch. Rejection and missing wallets produce recoverable messages.
- Every snapshot verifies RPC chain ID, nonempty code at both addresses, and the token read from `BurnLeaderboard.token()` against LaunchToken. Balance and allowance reads use that returned token address. Metadata must be PYRE with 18 decimals. Unverified, wrong-chain, stale, loading, or disconnected states cannot pay.
- Approve PYRE grants the **exact entered amount** to BurnLeaderboard. Existing sufficient allowance marks step 1 complete. Burn remains disabled until balance and allowance cover the amount and the permanent-burn checkbox is selected. Editing the amount clears confirmation. There is no unlimited approval shortcut.
- Approve, burn and sweep are simulated before signing. Wallet account and chain are checked immediately before simulation and again before the signing request. Receipt success, rejection, simulation failure, pending state and explorer links are shown. A transaction times out after 120 seconds; its explorer link remains available. Replacement transactions are checked before claiming success.
- Sweep is in the contract-details disclosure. It forwards stray contract-held PYRE to DEAD with no credit to the caller; it uses an explicit browser confirmation and needs no PYRE allowance. The visitor pays only gas.
- The approved workflow says **no in-page swap**. The page explains that PYRE comes from swapping Sepolia ETH in the launch pool. Quotes, exchange rates, slippage, pool liquidity controls and Uniswap/Permit2 approvals are therefore not applicable. The only token approval on this page is PYRE → BurnLeaderboard, as required by `burn`.

## State and ranking

All view reads in a snapshot share one block number. Both top tens come directly from views. A connected wallet's rank, including below tenth place, is computed from all `Burned` logs from the handoff deployment block to that snapshot. Logs are paginated (initially 5,000 blocks; smaller ranges on failure), sorted by block/transaction/log position, and deduplicated. Ties use the first attainment of the current total. Current-season totals include only that season. Display season 01 means contract season 0.

The event sum must equal `totalBurned`; reconstructed leaders must agree with both contract views; the reference block hash must still match. On failure the rank is unavailable rather than inferred. Each refresh rescans history, avoiding persistent orphaned logs. This is intentionally simple for a small launch; long histories can be slow or rate-limited. Progress is shown and rank failure does not conceal successfully read contract totals. Refreshes run every 30 seconds, with no overlapping history scan. After 90 seconds a snapshot is too stale for actions. Wallet changes invalidate in-flight display results and consent.

Balances and arithmetic use bigint. Summary values show up to four fractional digits; a nonzero smaller amount displays `<0.0001`, with the exact value in its title. Amount entry, maximum selection, approval and permanent-burn confirmation preserve all 18 decimals. Full contract addresses and explorer links are available in the disclosure.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run check:export
npx tsx scripts/check-live.ts  # read-only RPC evidence; never sends a transaction
node tests/prepare-browser.mjs
```

The last command creates `test/scratch/browser-test.js` using the actual exported ABI/configuration. With the subpath preview running, open a **fresh browser tab** and pass that file to the available Playwright browser tool's `browser_run_code_unsafe` filename argument. Alternatively evaluate the generated function with a local Playwright `page`. It mocks every configured RPC endpoint and injects a mock EIP-1193 wallet; all transactions stay inside the fixture. If the tool returns early at the sweep confirmation, the script's dialog handler finishes it, then retrieve `window.__validation` with page evaluation. `tests/browser.template.js` is the delivered test source; generated fixtures and dependency caches are not committed.

See [validation](../docs/VALIDATION.md), [design documentation](../docs/DESIGN.md), and [evidence](../docs/evidence/). The rendered checks are Chromium only. No live approval, burn, sweep, wallet signature, swap, site publication or contract deployment was performed.

## Submission hygiene

`web/.gitignore` has an explicit 1 KiB path budget and is 116 bytes. It excludes dependency, cache, coverage and generated test-report directories at every nesting level within `web/`. Dependencies remain normal npm packages with an exact lockfile; no registry mirror, archives or submodules are added. Runtime notices are in `THIRD_PARTY_NOTICES.txt` and are copied into the export. Validation screenshots and documentation are outside the runtime export.

The assignment's root `DESIGN.md` location conflicts with its higher-priority writable paths. Its complete content is delivered as `docs/DESIGN.md`; no root file is added.
