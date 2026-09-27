# Contract ABI interface

[LaunchToken.json](LaunchToken.json) and [BurnLeaderboard.json](BurnLeaderboard.json)
are ABI arrays generated with the pinned compiler using
`python3 scripts/export_abis.py`. Use `--check` to compare exports without writing.
Amounts are uint256 minor units (18 decimals); JavaScript clients must use bigint.

LaunchToken has no constructor arguments. Its standard ERC-20 interface exposes
`name()`, `symbol()`, `decimals()`, `totalSupply()`, `balanceOf(address)`,
`allowance(address,address)`, `approve(address,uint256)`, `transfer(address,uint256)`
and `transferFrom(address,address,uint256)`, plus `Transfer` and `Approval` events.
Transfers reject the zero receiver and insufficient balance; transferFrom also
checks allowance. Maximum uint256 allowances are not decremented. There is no
public mint or token-supply burn function.

BurnLeaderboard takes one nonpayable `address token_` constructor argument. It
exposes the following functions:

| Function | Result or effect |
| --- | --- |
| `token()` | Immutable PYRE token address. Read this before interacting with ERC-20. |
| `deployTimestamp()` | Immutable Unix timestamp at deployment, in seconds. |
| `DEAD()` | `0x000000000000000000000000000000000000dEaD`. |
| `SEASON_DURATION()` | `604800` seconds. |
| `currentSeason()` | Zero-based current season ID. |
| `lifetimeOf(address account)` | Total credited burns for that account, including amounts outside the top ten. |
| `seasonTotalOf(uint256 season, address account)` | Account's credited burns in the given season. |
| `totalBurned()` | Sum of every account's credited lifetime burns; excludes sweeps. |
| `topAllTime()` | Fixed `tuple[10]`, each tuple `(address account, uint256 total)`. |
| `topSeason(uint256 season)` | Same shape; historical, current or empty/future season. |
| `burn(uint256 amount)` | Nonpayable. Requires positive amount, sufficient PYRE balance and allowance from caller to app. Sends caller's PYRE directly to DEAD and updates totals and both boards. |
| `sweep()` | Nonpayable, anyone may call. Sends app's entire PYRE balance to DEAD with no ranking credit. |

Array positions correspond to ranks 1–10; zero-address entries are unused.
Order is descending total, then earliest achievement of that total. Historical
boards are immutable after rollover; unburned accounts have no rank.

Events:

```solidity
event Burned(address indexed account, uint256 amount, uint256 indexed season, uint256 lifetimeTotal);
event Swept(uint256 amount);
```

To compute a rank outside the top ten, fetch Burned logs emitted by this app from
its deployment block through one consistent reference block. Order them by
`(blockNumber, transactionIndex, logIndex)`. Set each account's lifetime total to
`lifetimeTotal` and add `amount` to its season total. Keep the log position where
each current total was reached. Sort descending by total, then ascending by that
position; exclude zero totals. Block timestamps alone cannot distinguish ties.
Use paginated RPC log reads and handle reorgs by discarding orphaned logs. Read
boards, balances, allowances and currentSeason against the same reference block
when presenting a consistent snapshot. Swept logs never affect ranks.

The app's own errors are `ZeroAmount()`, `InvalidToken()` and the inherited
`ReentrancyGuardReentrantCall()`. SafeERC20 may raise
`SafeERC20FailedOperation(address)` or bubble underlying ERC-20 errors, including
`ERC20InsufficientBalance(address,uint256,uint256)` and
`ERC20InsufficientAllowance(address,uint256,uint256)`. Decode bubbled PYRE errors
with the token ABI. The generated app ABI also includes OpenZeppelin Address
library errors. Failed transactions emit no persistent Burned or Swept event.
