# Pyre contracts

Pyre (PYRE) is a fixed-supply ERC-20 and an ownerless burn leaderboard intended for
Sepolia (chain ID **11155111**). This contribution delivers the contracts, Foundry
tests, vendored dependencies and compiler-generated ABI exports. The separate
manifest contribution creates `launch.json`; an independent contributor reviews
the accepted source together with that manifest before service publication and
deployment. No deployment or independent-review result is claimed here.

Build and verify with Foundry and Solidity 0.8.26 installed:

```sh
forge build
forge test
forge fmt --check
python3 scripts/export_abis.py --check
```

Dependencies are ordinary source files under `lib/`; no network dependency
resolution, submodules, environment variables, FFI or filesystem cheatcode
permissions are needed. `foundry.toml` pins Solidity 0.8.26, Cancun, optimizer
200 runs and `bytecode_hash = "none"`. See [dependency provenance](docs/dependencies.md).
Regenerate ABI exports with `python3 scripts/export_abis.py` after source changes.

## Contracts and deployment parameters

| Artifact | Constructor arguments | Behavior at deployment |
| --- | --- | --- |
| `src/LaunchToken.sol:LaunchToken` | None | Mints exactly `1000000000000000000000000000` minor units to `msg.sender` (the project factory). Name `Pyre`, symbol `PYRE`, decimals 18. |
| `src/BurnLeaderboard.sol:BurnLeaderboard` | One `address token_`, manifest `constructorArgs: ["$token"]` | Stores the already-deployed PYRE address and deployment timestamp immutably; requires contract code at the address. Makes no token call or supply transfer. |

The project uses kind `evm_project`, `LaunchToken` as its launch token, and exactly
one application entry named `BurnLeaderboard`. Deploy the token before the app
through ProjectFactory. Both constructors are nonpayable and need no
initialization calls. There is no owner parameter, privileged beneficiary,
operator, proxy, upgrade, pause, fee, blocklist or later mint path. The factory
retains the entire initial supply until its protocol allocation to liquidity and
rewards; the app starts with zero PYRE and needs no allocation. Actual factory,
deployment addresses, policy and signed-artifact linkage come from the launch
services and are not hard-coded here. Sepolia selection is enforced by those
services and the eventual UI, not by a constructor chain-ID restriction.

## Burning and rankings

Players obtain PYRE by swapping Sepolia ETH in the factory-seeded launch pool.
They approve BurnLeaderboard on the PYRE token, then call `burn(amount)` with a
positive amount in minor units. An exact allowance for the intended amount is
sufficient. `SafeERC20.safeTransferFrom` sends that amount **directly from the
caller** to `0x000000000000000000000000000000000000dEaD`. Only the caller receives
ranking credit. There is no beneficiary argument, signature relay or permit.

A burn increments the caller's lifetime and current-season totals, and
`totalBurned`. It is irreversible; there is no prize, payout, refund, withdrawal
or settlement mechanism. These burns are dead-address transfers, so ERC-20
`totalSupply()` remains exactly one billion PYRE. Transfers to the dead address
outside `burn()` do not receive credit.

Season IDs start at zero and equal
`(block.timestamp - deployTimestamp) / 604800`. A burn at exactly deployment time
plus seven days belongs to season one. No keeper, oracle, randomness, manual close
or transaction is needed for rollover. Each season has its own totals and board;
closed boards are never written again. Empty or future seasons return zero totals
and ten empty entries.

Both boards hold ten `(account, total)` entries in descending order, padded with
`(address(0), 0)`. Equal totals retain the order in which accounts reached that
total, including burns within the same block. Existing entries move upward without
duplicates. A newcomer to a full board must strictly exceed the tenth total.
Unlisted and evicted accounts retain their totals and can enter later. Per board,
an update searches at most ten entries and shifts at most nine; cost does not
grow with participant count or season history. Totals and historical storage do
grow with usage, but no write iterates over that history.

## Custody and assumptions

The intended token is the supplied, immutable, exact-transfer LaunchToken.
Constructor validation rejects zero addresses and EOAs; it does not authenticate
arbitrary token implementations. SafeERC20 checks transfer results, but cannot
make a lying, rebasing or fee-on-transfer token suitable for amount-based ranking.
The independent manifest review must confirm the app's argument is `$token`.

Ordinary burns leave the app's token balance at zero. More precisely, a burn
leaves any preexisting donated balance unchanged: it never takes custody of the
burn payment. Anyone can call `sweep()` to send all accidentally deposited PYRE
to the dead address, credited to nobody. Empty sweeps succeed and emit
`Swept(0)`. Sweeps do not alter `totalBurned` or either board. The accounting
identity is `totalBurned == sum(lifetimeOf(account))`; dead-address balance may
also include uncredited donations and sweeps.

Both mutations are nonReentrant. Burn accounting follows checks-effects-
interactions, and failed token transfers revert all state, ordering changes and
events. Sweep has no internal claim accounting and never pays the caller. There
are no payable functions, receive or fallback functions. Ordinary ETH sends
revert. EVM mechanisms can still force ETH into an address; there is no native
currency recovery path. Other accidentally sent token types cannot be recovered.

## Verification and operational handoff

Tests cover token supply and transfers, factory-style deployment with no app
funding, forbidden runtime opcodes, insertions, reordering, tie precedence,
cutoff equality, eviction and reentry, exact season boundaries, frozen history,
caller attribution, zero amounts, insufficient balance/allowance, sweeping,
ETH rejection, rollback on false/reverting token results, optional return values,
and all burn/sweep reentrancy combinations. Gas checks compare full-board insertions
before and after 160 extra participants and after 1,000 elapsed seasons.

Stateful invariants mix burns, donations, sweeps and time advances for 24 actors,
with 128 runs of 64 calls and no tolerated handler reverts. A separate dense
sequence fuzz test exercises 96 burns per case, including full boards and a
season transition. An independent reference model selects maxima across all
actors using explicit achievement sequence numbers; it checks ordering,
membership, ties, accounting, attribution, frozen history and token conservation.
These are local adversarial tests, not an independent security audit.

The next independent reviewer should attack top-ten corruption under arbitrary
burn sequences, tie handling, bounded insertion gas, exact boundaries and wrong
caller credit, and inspect actual constructor arguments with the manifest.
Services then publish source, attest, admit and deploy. No funded-wallet access,
broadcast script or external transaction is part of this contribution.

The later website assignment uses the live Sepolia deployment and the
[ABI documentation](docs/abi/README.md). It publishes the single-page
`lab-burn-leaderboard` static export with `dist/index.html`, reads the PYRE address
from `token()`, shows balance and allowance, presents approval before burning,
and explains the external launch-pool swap. Lists use the contract views;
off-board ranks come from ordered `Burned` logs, with no backend or indexer.
GitHub/IPFS publication belongs to the later services/frontend work.
