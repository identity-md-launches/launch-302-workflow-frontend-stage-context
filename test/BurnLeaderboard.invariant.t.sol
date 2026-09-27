// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {BurnLeaderboard} from "../src/BurnLeaderboard.sol";

contract BurnHandler is Test {
    uint256 public constant ACTORS = 24;
    LaunchToken public immutable token;
    BurnLeaderboard public immutable board;
    uint256 public sequence;
    uint256 public swept;
    uint256 public donated;
    uint256 public pendingDonation;
    uint256[24] public lifetime;
    uint256[24] private _lifetimeReached;
    mapping(uint256 => uint256[24]) public seasonTotals;
    mapping(uint256 => uint256[24]) private _seasonReached;
    mapping(uint256 => bytes32) public frozenBoards;
    uint256[] public closedSeasons;

    constructor(LaunchToken token_, BurnLeaderboard board_) {
        token = token_;
        board = board_;
    }

    function actor(uint256 index) public pure returns (address) {
        return address(uint160(0x1000 + index));
    }

    function burn(uint256 actorSeed, uint256 amountSeed) external {
        uint256 index = actorSeed % ACTORS;
        uint256 amount = bound(amountSeed, 1, 100);
        uint256 season = board.currentSeason();
        ++sequence;
        lifetime[index] += amount;
        _lifetimeReached[index] = sequence;
        seasonTotals[season][index] += amount;
        _seasonReached[season][index] = sequence;
        vm.prank(actor(index));
        board.burn(amount);
        // A burn never takes custody; only unswept, unrelated donations can remain.
        assertEq(token.balanceOf(address(board)), pendingDonation);
    }

    function donate(uint256 actorSeed, uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 100);
        vm.prank(actor(actorSeed % ACTORS));
        token.transfer(address(board), amount);
        donated += amount;
        pendingDonation += amount;
    }

    function sweep(uint256 actorSeed) external {
        swept += pendingDonation;
        pendingDonation = 0;
        vm.prank(actor(actorSeed % ACTORS));
        board.sweep();
        assertEq(token.balanceOf(address(board)), 0);
    }

    function advanceTime(uint256 secondsSeed) external {
        uint256 oldSeason = board.currentSeason();
        uint256 step = bound(secondsSeed, 0, 8 days);
        bytes32 beforeBoard = keccak256(abi.encode(board.topSeason(oldSeason)));
        vm.warp(block.timestamp + step);
        if (board.currentSeason() != oldSeason) {
            frozenBoards[oldSeason] = beforeBoard;
            closedSeasons.push(oldSeason);
        }
    }

    function closedCount() external view returns (uint256) {
        return closedSeasons.length;
    }

    /// @dev Independent reference: select ten maxima from ALL actors, breaking ties
    /// by the burn sequence at which the current total was reached. No insertion algorithm.
    function expectedBoard(bool allTime, uint256 season)
        external
        view
        returns (BurnLeaderboard.Entry[10] memory result)
    {
        uint256[24] memory totals = allTime ? lifetime : seasonTotals[season];
        uint256[24] memory reached = allTime ? _lifetimeReached : _seasonReached[season];
        for (uint256 rank; rank < 10; ++rank) {
            uint256 best;
            for (uint256 i = 1; i < ACTORS; ++i) {
                if (totals[i] > totals[best] || (totals[i] == totals[best] && reached[i] < reached[best])) {
                    best = i;
                }
            }
            if (totals[best] == 0) break;
            result[rank] = BurnLeaderboard.Entry(actor(best), totals[best]);
            totals[best] = 0;
        }
    }
}

contract BurnLeaderboardInvariantTest is Test {
    LaunchToken private token;
    BurnLeaderboard private board;
    BurnHandler private handler;

    function setUp() public {
        vm.warp(50_000);
        token = new LaunchToken();
        board = new BurnLeaderboard(address(token));
        handler = new BurnHandler(token, board);
        for (uint256 i; i < handler.ACTORS(); ++i) {
            address account = handler.actor(i);
            token.transfer(account, 1_000_000 ether);
            vm.prank(account);
            token.approve(address(board), type(uint256).max);
        }
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.burn.selector;
        selectors[1] = handler.donate.selector;
        selectors[2] = handler.sweep.selector;
        selectors[3] = handler.advanceTime.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_rankingsAccountingAndFrozenHistory() public view {
        uint256 sum;
        uint256 season = board.currentSeason();
        uint256 held = token.balanceOf(address(this)) + token.balanceOf(address(board)) + token.balanceOf(board.DEAD());
        for (uint256 i; i < handler.ACTORS(); ++i) {
            address account = handler.actor(i);
            uint256 total = handler.lifetime(i);
            sum += total;
            held += token.balanceOf(account);
            assertEq(board.lifetimeOf(account), total, "wrong lifetime credit");
            assertEq(board.seasonTotalOf(season, account), handler.seasonTotals(season, i), "wrong season credit");
        }
        assertEq(board.totalBurned(), sum);
        assertEq(token.balanceOf(board.DEAD()), sum + handler.swept());
        assertEq(token.balanceOf(address(board)), handler.pendingDonation());
        assertEq(handler.donated(), handler.swept() + handler.pendingDonation());
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(held, token.totalSupply(), "lost tokens");
        assertEq(abi.encode(board.topAllTime()), abi.encode(handler.expectedBoard(true, season)), "all-time mismatch");
        assertEq(
            abi.encode(board.topSeason(season)), abi.encode(handler.expectedBoard(false, season)), "season mismatch"
        );
        for (uint256 i; i < handler.closedCount(); ++i) {
            uint256 past = handler.closedSeasons(i);
            bytes memory pastBoard = abi.encode(board.topSeason(past));
            assertEq(keccak256(pastBoard), handler.frozenBoards(past), "historical board changed");
            assertEq(pastBoard, abi.encode(handler.expectedBoard(false, past)), "historical ranking mismatch");
            for (uint256 j; j < handler.ACTORS(); ++j) {
                assertEq(board.seasonTotalOf(past, handler.actor(j)), handler.seasonTotals(past, j));
            }
        }
    }

    function testFuzz_denseBurnSequencesMatchIndependentRanking(uint256 seed) public {
        // Dense sequences exercise full boards even when the invariant scheduler
        // chooses frequent season changes. Small amounts deliberately create ties.
        for (uint256 i; i < 96; ++i) {
            if (i == 64) handler.advanceTime(7 days);
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 account = i < 24 ? i : seed % 24;
            handler.burn(account, 1 + (seed >> 128) % 20);
            uint256 season = board.currentSeason();
            assertEq(abi.encode(board.topAllTime()), abi.encode(handler.expectedBoard(true, season)));
            assertEq(abi.encode(board.topSeason(season)), abi.encode(handler.expectedBoard(false, season)));
            assertEq(token.balanceOf(address(board)), 0);
        }
        invariant_rankingsAccountingAndFrozenHistory();
    }
}
