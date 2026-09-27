// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Ownerless PYRE burn rankings with independent seven-day seasons.
/// @dev Intended exclusively for the immutable, exact-transfer LaunchToken.
contract BurnLeaderboard is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Entry {
        address account;
        uint256 total;
    }

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant SEASON_DURATION = 7 days;

    IERC20 public immutable token;
    uint256 public immutable deployTimestamp;
    uint256 public totalBurned;

    mapping(address account => uint256 total) public lifetimeOf;
    mapping(uint256 season => mapping(address account => uint256 total)) public seasonTotalOf;
    Entry[10] private _allTime;
    mapping(uint256 season => Entry[10]) private _seasons;

    error ZeroAmount();
    error InvalidToken();

    event Burned(address indexed account, uint256 amount, uint256 indexed season, uint256 lifetimeTotal);
    event Swept(uint256 amount);

    /// @param token_ The already-deployed PYRE launch token; manifest argument "$token".
    constructor(address token_) {
        if (token_.code.length == 0) revert InvalidToken();
        token = IERC20(token_);
        deployTimestamp = block.timestamp;
    }

    /// @notice Transfer caller-owned PYRE directly to DEAD and credit only the caller.
    /// @dev Requires allowance. All accounting rolls back if the transfer fails.
    function burn(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 season = currentSeason();
        uint256 lifetimeTotal = lifetimeOf[msg.sender] + amount;
        uint256 seasonTotal = seasonTotalOf[season][msg.sender] + amount;
        lifetimeOf[msg.sender] = lifetimeTotal;
        seasonTotalOf[season][msg.sender] = seasonTotal;
        totalBurned += amount;
        _update(_allTime, msg.sender, lifetimeTotal);
        _update(_seasons[season], msg.sender, seasonTotal);

        token.safeTransferFrom(msg.sender, DEAD, amount);
        emit Burned(msg.sender, amount, season, lifetimeTotal);
    }

    /// @notice Anyone can forward accidentally deposited PYRE to DEAD, without ranking credit.
    /// @dev An empty sweep succeeds and emits Swept(0). No caller receives funds.
    function sweep() external nonReentrant {
        uint256 amount = token.balanceOf(address(this));
        if (amount != 0) token.safeTransfer(DEAD, amount);
        emit Swept(amount);
    }

    function currentSeason() public view returns (uint256) {
        return (block.timestamp - deployTimestamp) / SEASON_DURATION;
    }

    /// @notice Descending totals, earliest to reach a tie first; unused entries are (0, 0).
    function topAllTime() external view returns (Entry[10] memory) {
        return _allTime;
    }

    /// @notice Historical boards remain frozen; future and unused boards contain zero entries.
    function topSeason(uint256 season) external view returns (Entry[10] memory) {
        return _seasons[season];
    }

    /// @dev At most ten comparisons to find an account and nine shifts per board.
    /// Totals only increase. Strict comparisons retain earlier achievers ahead of ties.
    function _update(Entry[10] storage board, address account, uint256 total) private {
        uint256 index = 0;
        while (index < 10 && board[index].account != account) {
            ++index;
        }
        if (index == 10) {
            if (total <= board[9].total) return;
            index = 9;
        }
        while (index > 0 && total > board[index - 1].total) {
            board[index] = board[index - 1];
            --index;
        }
        board[index] = Entry(account, total);
    }
}
