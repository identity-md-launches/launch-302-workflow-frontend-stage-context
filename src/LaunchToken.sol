// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply Pyre (PYRE), minted entirely to the deploying factory.
contract LaunchToken is ERC20 {
    constructor() ERC20("Pyre", "PYRE") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}
