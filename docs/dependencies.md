# Vendored dependency provenance

Only ordinary source files and their licenses are vendored. No package manager,
submodule or network fetch is needed for builds once Solidity 0.8.26 and Foundry
are installed. Upstream source is unmodified.

| Dependency | Pinned source | Included files |
| --- | --- | --- |
| OpenZeppelin Contracts | [v5.0.2](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v5.0.2) | ERC20, IERC20, IERC20Metadata, IERC20Permit, SafeERC20, Context, Address, ReentrancyGuard, draft-IERC6093 and MIT license. |
| forge-std | [v1.9.7](https://github.com/foundry-rs/forge-std/tree/v1.9.7) | `src/` and MIT/Apache licenses; used only by tests. |

Archive SHA-256 digests of the downloaded tag snapshots:

```text
https://codeload.github.com/OpenZeppelin/openzeppelin-contracts/tar.gz/refs/tags/v5.0.2
18c7b7e949b9a82dcd8cd394426c9c2636dfc263aa2317d4749dbfa0c7b3925a

https://codeload.github.com/foundry-rs/forge-std/tar.gz/refs/tags/v1.9.7
45157353ab49eab01d294565866731e599b32401757229689ee459aa26b7ee94
```

These digests record the source used here; they are not independent signatures.
The selected OpenZeppelin files include the complete import closure for both
production contracts. Address contains helper routines unused by these contracts;
local tests scan the compiled production runtimes to confirm absence of
DELEGATECALL, CALLCODE and SELFDESTRUCT, skipping PUSH immediate bytes.
