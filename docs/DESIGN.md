# Pyre design

## Overview

Pyre is a single-page burn leaderboard for visitors using PYRE on Sepolia. The implemented design uses warm charcoal surfaces, cream text, an ember action color and compact numerical tables. The headline explains the purpose; the adjacent card contains the approval and burn flow. Wallet totals precede the two leaderboards. Contract details and the less common sweep action use native disclosures.

This is the final implementation, not an additional design specification. Source: `web/src/styles.css` and `web/src/App.tsx`. The location is `docs/DESIGN.md` because the assignment's explicit write scope excludes a root `DESIGN.md`.

## Colors

Colors use hexadecimal primitive tokens and semantic aliases in `styles.css:1`. The interface deliberately has one dark presentation, with browser forced-colors support; there is no theme switch.

| Semantic token | Primitive/value | Role |
| --- | --- | --- |
| `--color-page` | neutral-950 `#141513` | Page and amount input |
| `--color-surface` | neutral-900 `#1d1e1b` | Burn card, empty boards, connected-wallet row |
| `--color-hover` | neutral-850 `#262723` | Neutral control hover |
| `--color-border` | neutral-700 `#585b51` | Structural table and section dividers |
| `--color-control-border` | neutral-600 `#72756a` | Enabled buttons and amount field boundary |
| `--color-muted` | neutral-400 `#afb2a7` | Supporting text and labels |
| `--color-text`, `--color-focus` | neutral-100 `#f2f0e8` | Primary text and keyboard outlines |
| `--color-accent` | ember-400 `#ffac75` | Current transaction step background |
| `--color-accent-hover` | ember-300 `#ffc097` | Primary action hover |
| `--color-on-accent` | neutral-950 `#141513` | Text inside primary action |
| `--color-error` | red-300 `#ffaba7` | Field and transaction errors |

Measured rendered ratios: body/page 16.05:1; muted/card 7.78:1; primary action text/fill 9.95:1; input boundary/page 3.90:1 and boundary/card 3.56:1. The focus outline around the amount input is 16.05:1 against the input background. See `evidence/accessibility.json`; these are specific pairs, not a blanket accessibility claim. Status also uses text, and active rows carry “You”.

## Typography

The stack is `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. No font files or remote font request are shipped. Inter is used only if locally available; rendering otherwise follows system fallbacks. Individual installed font faces were not identified. Global text is 16px/1.5, weight 400, with tabular numerals and root font smoothing.

Semantic size tokens: caption 13px, small 14px, body 16px, section 22px, stat 32px. The display headline is `clamp(2.9rem, 5.8vw, 4.6rem)`, line-height 1.04, weight 550, letter-spacing −0.065em. On the stacked layout its middle value is 8vw. Section headings use weight 600 and line-height 1.2. Wallet-stat values are 18px/500; balance labels remain subordinate. CSS weights are requests to the platform, not promises of separately loaded faces.

Headings balance wrapping, prose uses `text-wrap: pretty`, the introduction is limited to 43ch, and disclosure prose to 65ch. Full addresses wrap anywhere. Table numbers align to the trailing edge. Input text is 24px, avoiding small-input mobile zoom. Exact amounts remain in titles; transaction confirmation always shows the full entered decimal amount. Link underlines are visible with font-derived thickness and 0.2em offset.

## Layout

The page shell is at most 1,248px including padding. Inline margins are `clamp(1rem, 4vw, 3rem)`. The spacing scale is 4, 8, 12, 16, 24, 32 and 48px; a few larger gaps establish page-level grouping. Normal document flow keeps actions reachable without sticky overlays.

- Expanded hero: `minmax(0, 1fr)` plus `minmax(330px, .74fr)`, with a responsive gap. Burn-card padding is 24px, radius 16px.
- At 62rem and below: wallet summary becomes four columns with its title above them.
- At 49rem and below: hero, boards and disclosures become single columns; the redundant header network label hides, while the network remains named in body and wrong-chain controls.
- At 32rem and below: wallet metrics become two columns; card padding becomes 20px; header actions may wrap internally rather than clip.

The two `Board` instances share fixed-layout semantic tables (15% rank, 43% wallet, remaining amount), with no horizontal scroller. Rendered populated states were checked at 1,280, 800, 390 and 320px; page overflow was absent. A 200% text enlargement check also passed. Browser-native zoom and physical mobile devices were not tested.

## Elevation & Depth

Surfaces are flat with no box shadows or gradients. The darker page and lighter card create grouping. Borders separate rows and sections; a stronger border identifies controls. A skip link uses z-index 10 only while focused. Sweep uses the browser's own confirmation dialog; there is no custom overlay system.

## Shapes

Cards have a 16px radius. Inputs, buttons and empty-state panels have 8px radii. Small top-ten badges use 5px. Borders are 1px; keyboard outlines are 2px with a 4px offset (checkbox offset 3px). Brand artwork is a small inline, decorative flame SVG shared through `Flame`; the favicon uses the same path. No raster brand assets are required.

## Components

`App.tsx` defines local components, not a separate component library:

| Pattern | Source/API | Behavior |
| --- | --- | --- |
| `Flame` | No props | Decorative SVG using current text color |
| `Amount` | `value`, optional `decimals` | bigint formatting, tabular numbers, precise title |
| `Board` | `title`, `subtitle`, `rows`, `config`, `account`, `loading` | View-derived top ten; captions and column scopes; current wallet marked; distinct empty/loading/unavailable content |
| Burn card | `.burn-card`, `.steps` | Balance, allowance, labeled decimal field, exact approval, permanent-burn consent and transaction state |
| Action buttons | `.primary`, `.secondary`, native `disabled` | Only the current actionable step receives the accent fill; prerequisite failures have adjacent explanations |
| Wallet control | `.wallet-button` | Connect, shortened connected address, local disconnect, busy text |
| Disclosures | Native `details`/`summary` | Token acquisition explanation and contract/sweep details; keyboard Enter/Space works natively |
| Feedback | Status and alert regions | Confirmation progress, receipt link, rejection, RPC and configuration failure; no timed disappearing errors |

Every button is at least 44px tall; the checkbox label also reserves 44px. Focus uses `:focus-visible`, and native elements provide keyboard semantics. There is a skip link and one main landmark. Color changes are 150ms; enabled button press scale is 0.96 only under `prefers-reduced-motion: no-preference`. Reduced motion removes these transitions. Forced-colors uses the system `Highlight` outline.

## Do's and Don'ts

- Reuse the page shell, spacing tokens and `Board` pattern for another contract-backed section; keep its title and explanation next to the data.
- Use the accent fill for the current primary step, and the error token only for errors. Keep structural dividers distinct from control boundaries.
- Keep token amounts as bigint through validation and signing. Preserve exact decimal confirmation and explicit irreversible-action wording.
- Keep full addresses available in links/details, and preserve table headings and captions when changing density.
- Add another page only with a static-compatible entry or hash navigation. Load its deployment through the existing runtime configuration.
- Do not add fabricated leaderboard rows, decorative charts, font downloads, or an in-page swap to this approved workflow.

Design guidance: Jakub Krehel's Better Interface, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method: Paul Bakaus's Impeccable, Apache-2.0, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. See attribution in `VALIDATION.md`.
