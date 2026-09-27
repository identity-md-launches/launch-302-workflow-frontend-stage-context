# Frontend validation

Worker validation performed on 2026-09-27. **Implementation and worker validation complete for the authorized frontend scope.** The checkout commit is blocked by its read-only `.git` mount; the source, lockfile, export and evidence are present for the submission system. The root design-file location exception is explained below. These observations are the worker's evidence, not independent network certification.

## Scope and assumptions

One React/TypeScript page, Vite relative export in `dist/`, for the supplied Sepolia deployment. Implementation ABIs were obtained from `docs/abi/` at source commit `9f3a8d70d37c2c85e5ca65d1cb7cc2b089c2b251`; neither contracts nor root build configuration changed. No backend, indexer, in-page swap, redeployment or publication. The approved workflow's explicit no-swap requirement controls the generic swap guidance. App approval is necessarily to BurnLeaderboard; no Uniswap or Permit2 transaction is made.

The visual direction was inferred: dark neutral surfaces, warm primary action, plain confirmation copy. Display seasons start at 01 while on-chain IDs start at 0. “Burn” means transfer to DEAD, as in the contract; ERC-20 `totalSupply()` itself does not decrease.

The root `DESIGN.md` criterion conflicts with the user rule allowing writes only in `web/**`, `dist/**`, and `docs/**` (plus the explicit ignore path). The complete design document is therefore `docs/DESIGN.md`. No root file was created. `web/.gitignore` was assigned an explicit 1 KiB budget before creation.

## Commands and results

Commands were run from `web/` unless otherwise stated.

| Check | Result |
| --- | --- |
| `npm install --cache /tmp/pyre-npm-cache --no-audit --no-fund` | Successful; dependencies and exact npm lockfile local to web |
| `npm run typecheck` (also runs inside every build) | Passed; strict TypeScript, no emit |
| `npm test` | 6 tests passed, 0 failures |
| `npm run build` | Final build passed; relative local CSS/JS, implementation ABIs and license notices exported |
| `npm run check:export` | Passed; both canonical ABI hashes and complete final asset inventory match |
| `npx tsx scripts/check-live.ts` | Read-only Sepolia snapshot succeeded; evidence saved |
| `node tests/prepare-browser.mjs` + supplied Playwright browser tool | 32 assertions passed in the production export, zero uncaught JS errors |
| axe-core 4.10.3 on populated desktop | 47 rules passed, zero violations; one manually reviewed incomplete item |

Final export: **524,991 bytes**, seven declared assets plus the manifest, largest file 476,439 bytes. This leaves ample room in the HTTP verification budget. `index.html`, all JavaScript/CSS, both ABI files and notices are included in SHA-256 inventory; the manifest excludes itself. The network object is copied unchanged and the complete contract set, addresses, chain, launch ID, source commit and attestation hash match the supplied handoff. No source maps, npm archives, registry mirrors or dependency directories are exported.

The build's ABI checks printed:

| Contract | Canonical Keccak-256 |
| --- | --- |
| LaunchToken | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| BurnLeaderboard | `3fec5ce7e0a299c7bfacf751083db7035ac970a6f7e8f2b952462be19d2afad6` |

An independent Python check compared the export directly to the original pinned handoff/network inputs, checked the exact contract set and every SHA-256, and found no difference. A browser HTTP check fetched all seven declared assets through `/preview/`: every response was 200 and every browser-computed SHA-256 matched (`evidence/http-assets.json`).

## Interaction and live evidence

The production export was served at `http://localhost:5180/preview/`, not through the Vite development server. This is a local test URL, not a published website. Runtime deployment/ABI fetches and local resources loaded successfully under that subpath. The final live reload had zero console errors or warnings.

`evidence/browser-interactions.json` records 32 assertions and the three captured **mock** transaction requests. The scenario covers disconnected, connection rejection, unknown-chain addition and switching, wrong-chain gating, balance/allowance reads, rank 11, zero/excess-balance/excess-precision amounts, Max, rejected approval, exact approval, irreversible confirmation, failed simulation without signing, successful burn and refreshed rank 2, sweep, account changes, missing code, wrong token binding, failed event history, responsive widths, text enlargement and reduced motion. All configured public RPC endpoints were intercepted; `eth_sendTransaction` was handled only by the injected mock wallet. No real transaction was broadcast.

Additional keyboard walk completed Approve → checkbox confirmation → Burn using Tab, Enter and Space. A separate tab tampered with LaunchToken ABI JSON and observed connection/actions blocked. A clean tab without an injected wallet displayed recovery instructions. See `evidence/additional-interactions.json`.

`evidence/live-read.json` records the real read-only check at block **11,791,427**, chain ID **11155111**. LaunchToken had 1,722 bytes of runtime code and BurnLeaderboard had 2,871; `token()` matched the attested PYRE address. Metadata was PYRE/18, total burned was zero, both boards were empty, and no stray PYRE was held by the app. The final browser read at block **11,791,450** also showed these empty boards.

Screenshots were captured and visually inspected:

- `evidence/desktop-mock.png`: 1,280px, populated boards and visible keyboard focus on amount input.
- `evidence/mobile-mock.png`: 320px, populated single-column layout; document width exactly 320px.
- `evidence/live-empty.png`: final live deployment read, disconnected wallet, empty boards.

The six focused tests cover exact bigint input, invalid/overflow inputs, deduplication and tie order, rank outside top ten, cross-season totals, switch/add/rejection behavior, wallet/chain/simulation write guards, adaptive log pagination, incomplete histories, reference-block reorg detection and cancellation. Contract tests were read as supplied inputs; Solidity was unchanged and no Foundry suite was claimed as rerun.

## Better Interface consolidated review

The pinned workflow and core principles of all six domains were read and applied before implementation. The documentation method was read after the rendered fixes. Supporting keyboard/form and motion guidance informed the controls.

| Domain | Coverage and evidence | Limitations |
| --- | --- | --- |
| Accessibility — Checked | Native buttons, labels, table captions/scopes, one main, skip link, live regions, visible keyboard focus; keyboard approval/burn; axe scan; disabled prerequisites | No screen-reader session or physical touch-device test; not a full WCAG certification |
| Layout — Checked | Desktop/mobile screenshots; no horizontal overflow at 1280, 800, 390, 320px; expanded details inspected; 200% text enlargement reflow | Native browser 200% zoom and RTL not tested; page is English only |
| Writing — Checked | Labels match approve/burn/sweep effects; permanent-burn consent names exact amount; wrong network/rejection/RPC recovery; no-reward and sweep-credit explanations | No localization or user comprehension study |
| Typography — Checked | Source roles/weights/measure, tabular numerals, large input, full-address wrapping; actual screenshot hierarchy and narrow wrapping | System font rendering varies; exact installed font face not established |
| Colors — Checked | Actual computed foreground/background pairs measured; input-boundary defect corrected; status has text; one current primary step | Disabled states are intentionally subdued; no alternate authored theme |
| UI — Checked | Disconnected, loading, populated, empty, unavailable, confirmation, pending/confirmed/error states; reduced-motion computed transition 0s; native disclosures | No animation-panel slow replay; no custom animated overlays exist |

Color measurements and axe output are in `evidence/accessibility.json`. Axe's sole incomplete item was the decorative refresh arrow (`.text-button > span[aria-hidden="true"]`), because its content is non-text. Its adjacent “Refresh data” label provides the accessible name; arrow/text use the same high-contrast foreground. It is not the sole indication of the action.

### Findings, fixes and rechecks

| Severity / source | Evidence and impact | Fix and recheck |
| --- | --- | --- |
| Medium — `web/src/App.tsx:64` | Network-added callback plus the explicit post-switch reset could invalidate a new read without scheduling another when the chain value was unchanged. First browser scenario waited until polling. | Added `sessionVersion` to trigger refresh after every session reset. Full scenario then reached rank 11 immediately and passed subsequent account changes. |
| Medium — `web/src/styles.css:84` | Computed amount-field boundary contrast was 2.64:1 on page and 2.42:1 on card, below the 3:1 control-boundary target. | Added semantic control-border token `#72756a`. Rendered remeasurement: 3.90:1 and 3.56:1. Final desktop/mobile screenshots inspected. |
| Low — `web/index.html:7` | First live browser navigation made a 404 favicon request. | Added local inline SVG favicon. Final browser reload reported zero console errors/warnings. |

No remaining observed blocker in the implemented scope. A failed experiment accessing Node globals inside the browser tool was not counted as a validation pass; the delivered browser fixture generator uses normal worker-side Node instead. Early TypeScript ABI-array narrowing errors were repaired before the first successful build.

## Git delivery constraint

`git add web dist docs` failed with `Unable to create .../.git/index.lock: Read-only file system`. No permission escalation or alteration of the protected Git directory was attempted. All deliverable files remain in the authorized paths for the contributor submission system to capture. A disposable repository and complete bundle under `test/scratch/` were used solely to measure the full Git submission size. The full-history bundle verified below **0.8 MiB**, well under the 8 MiB cap; all 41 changed files are within scope, with no submodules, dependency/cache directories or npm archives. Neither scratch Git metadata nor the duplicate archive is part of delivery. Browser-tool diagnostic files initially emitted outside the delivery paths were moved into scratch before the final path audit. Frontend dependency directories are excluded at every nesting level by the explicitly budgeted ignore file.

## Limits and remaining external work

No real wallet approval, burn, sweep, swap, signing, replacement/cancellation, insufficient-gas or live season-boundary transaction was performed. Those flows were simulated/mocked where described. No Safari, Firefox, native mobile wallet, screen reader, browser-native zoom, RTL, high-contrast OS session, or assistive-technology certification was performed. Public RPC failover code is present; a genuine provider outage was not forced on the live chain. Full history rescanning may become slow for a long-lived deployment and rank remains unavailable on incomplete history. No private endpoint is used.

The UI verifies chain ID, nonempty code, immutable token binding and ABI integrity, not a cryptographic comparison of deployed runtime bytecode. The manifest's attested binding and subsequent control-plane verification provide the publication linkage. IPFS pinning, site naming, immutable/named-copy HTTP checks and the independent publication gate remain the publisher/control plane's work.

Design source attribution: [Jakub Krehel, Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`; documentation method: [Paul Bakaus, Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. The two upstream works retain their own licenses. Guidance was read from the supplied pinned bundle; no upstream skill was installed or used to expand this task.
