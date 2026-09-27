// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {BurnLeaderboard} from "../src/BurnLeaderboard.sol";

contract BurnLeaderboardTest is Test {
    LaunchToken private token;
    BurnLeaderboard private board;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    address private constant CAROL = address(0xCA401);
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    event Burned(address indexed account, uint256 amount, uint256 indexed season, uint256 lifetimeTotal);
    event Swept(uint256 amount);

    function setUp() public {
        vm.warp(1_234_567);
        token = new LaunchToken();
        board = new BurnLeaderboard(address(token));
    }

    function test_initialStateAndEmptyBoards() public view {
        assertEq(address(board.token()), address(token));
        assertEq(board.deployTimestamp(), 1_234_567);
        assertEq(board.currentSeason(), 0);
        assertEq(board.totalBurned(), 0);
        assertEq(token.balanceOf(address(board)), 0);
        assertEq(board.lifetimeOf(ALICE), 0);
        assertEq(board.seasonTotalOf(0, ALICE), 0);
        _assertEmpty(board.topAllTime());
        _assertEmpty(board.topSeason(0));
        _assertEmpty(board.topSeason(type(uint256).max));
    }

    function test_constructorRejectsZeroAndEOA() public {
        vm.expectRevert(BurnLeaderboard.InvalidToken.selector);
        new BurnLeaderboard(address(0));
        vm.expectRevert(BurnLeaderboard.InvalidToken.selector);
        new BurnLeaderboard(ALICE);
    }

    function test_burnDirectlyCreditsCallerAndEmitsEvent() public {
        _fund(ALICE, 9 ether);
        vm.expectEmit(true, true, false, true, address(board));
        emit Burned(ALICE, 4 ether, 0, 4 ether);
        vm.prank(ALICE);
        board.burn(4 ether);
        assertEq(token.balanceOf(ALICE), 5 ether);
        assertEq(token.balanceOf(DEAD), 4 ether);
        assertEq(token.balanceOf(address(board)), 0);
        assertEq(board.lifetimeOf(ALICE), 4 ether);
        assertEq(board.seasonTotalOf(0, ALICE), 4 ether);
        assertEq(board.lifetimeOf(address(this)), 0);
        assertEq(board.lifetimeOf(address(token)), 0);
        assertEq(board.lifetimeOf(DEAD), 0);
        assertEq(board.totalBurned(), 4 ether);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        _assertBoth(0, ALICE, 4 ether);
    }

    function test_insertionAndReorderingNeverDuplicatesOrLosesEntries() public {
        _burn(ALICE, 10);
        _burn(BOB, 20);
        _burn(CAROL, 15);
        _assertBoth(0, BOB, 20);
        _assertBoth(1, CAROL, 15);
        _assertBoth(2, ALICE, 10);
        _burn(ALICE, 30);
        _assertBoth(0, ALICE, 40);
        _assertBoth(1, BOB, 20);
        _assertBoth(2, CAROL, 15);
        _burn(ALICE, 1);
        _assertBoth(0, ALICE, 41);
        _assertBoth(1, BOB, 20);
        _assertBoth(2, CAROL, 15);
        _assertBoth(3, address(0), 0);
        assertEq(board.totalBurned(), 76);
    }

    function test_tiesUseOrderReachedEvenWithinSameTimestamp() public {
        _burn(ALICE, 10);
        _burn(BOB, 10);
        _burn(CAROL, 5);
        _burn(CAROL, 5);
        _assertBoth(0, ALICE, 10);
        _assertBoth(1, BOB, 10);
        _assertBoth(2, CAROL, 10);
        _burn(CAROL, 1);
        _burn(BOB, 1);
        _burn(ALICE, 1);
        _assertBoth(0, CAROL, 11);
        _assertBoth(1, BOB, 11);
        _assertBoth(2, ALICE, 11);
    }

    function test_eleventhMustStrictlyExceedTenthThenEvictedAccountCanReturn() public {
        for (uint256 i; i < 10; ++i) {
            _burn(address(uint160(0x100 + i)), 100 - i);
        }
        _burn(ALICE, 90);
        _assertBoth(9, address(0x109), 91);
        _burn(ALICE, 1);
        _assertBoth(9, address(0x109), 91);
        assertEq(board.lifetimeOf(ALICE), 91);
        assertEq(board.seasonTotalOf(0, ALICE), 91);
        _burn(ALICE, 1);
        _assertBoth(8, address(0x108), 92);
        _assertBoth(9, ALICE, 92);
        _burn(address(0x109), 110);
        _assertBoth(0, address(0x109), 201);
        for (uint256 i = 1; i < 10; ++i) {
            _assertBoth(i, address(uint160(0x100 + i - 1)), 101 - i);
        }
    }

    function test_exactSevenDayBoundaryAndHistoricalImmutability() public {
        uint256 start = board.deployTimestamp();
        _burn(ALICE, 10);
        vm.warp(start + 7 days - 1);
        _burn(BOB, 20);
        assertEq(board.currentSeason(), 0);
        bytes32 historical = keccak256(abi.encode(board.topSeason(0)));
        vm.warp(start + 7 days);
        assertEq(board.currentSeason(), 1);
        _assertEmpty(board.topSeason(1));
        _fund(ALICE, 5);
        vm.expectEmit(true, true, false, true, address(board));
        emit Burned(ALICE, 5, 1, 15);
        vm.prank(ALICE);
        board.burn(5);
        assertEq(board.seasonTotalOf(0, ALICE), 10);
        assertEq(board.seasonTotalOf(1, ALICE), 5);
        assertEq(keccak256(abi.encode(board.topSeason(0))), historical);
        BurnLeaderboard.Entry[10] memory allTime = board.topAllTime();
        BurnLeaderboard.Entry[10] memory season = board.topSeason(1);
        assertEq(allTime[0].account, BOB);
        assertEq(season[0].account, ALICE);
        assertEq(season[0].total, 5);
        vm.warp(start + 21 days);
        assertEq(board.currentSeason(), 3);
        _burn(CAROL, 100);
        _assertEmpty(board.topSeason(2));
        assertEq(keccak256(abi.encode(board.topSeason(0))), historical);
        assertEq(board.topSeason(1)[0].total, 5);
        assertEq(board.totalBurned(), 135);
    }

    function test_sweepByAnyoneIsUncreditedAndEmptySweepIsSafe() public {
        _burn(ALICE, 10);
        token.transfer(address(board), 27);
        bytes32 allTime = keccak256(abi.encode(board.topAllTime()));
        bytes32 season = keccak256(abi.encode(board.topSeason(0)));
        vm.expectEmit(false, false, false, true, address(board));
        emit Swept(27);
        vm.prank(BOB);
        board.sweep();
        assertEq(token.balanceOf(address(board)), 0);
        assertEq(token.balanceOf(BOB), 0);
        assertEq(token.balanceOf(DEAD), 37);
        assertEq(board.totalBurned(), 10);
        assertEq(board.lifetimeOf(BOB), 0);
        assertEq(keccak256(abi.encode(board.topAllTime())), allTime);
        assertEq(keccak256(abi.encode(board.topSeason(0))), season);
        vm.expectEmit(false, false, false, true, address(board));
        emit Swept(0);
        board.sweep();
    }

    function test_burnDoesNotCustodyPaymentOrCreditPreexistingDonation() public {
        token.transfer(address(board), 123);
        _fund(ALICE, 7);
        vm.prank(ALICE);
        board.burn(7);
        assertEq(token.balanceOf(address(board)), 123);
        assertEq(token.balanceOf(DEAD), 7);
        assertEq(board.totalBurned(), 7);
        board.sweep();
        assertEq(token.balanceOf(address(board)), 0);
        assertEq(token.balanceOf(DEAD), 130);
        assertEq(board.totalBurned(), 7);
    }

    function test_zeroBurnReverts() public {
        vm.prank(ALICE);
        vm.expectRevert(BurnLeaderboard.ZeroAmount.selector);
        board.burn(0);
        assertEq(board.totalBurned(), 0);
        _assertEmpty(board.topAllTime());
        _assertEmpty(board.topSeason(0));
    }

    function test_missingAllowanceRollsBackAllAccounting() public {
        token.transfer(ALICE, 10);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(board), 0, 10));
        board.burn(10);
        _assertFailedBurnState();
        assertEq(token.balanceOf(ALICE), 10);
    }

    function test_insufficientBalanceRollsBackReorderingAndAllowance() public {
        _burn(BOB, 10);
        _fund(ALICE, 5);
        vm.prank(ALICE);
        token.approve(address(board), 11);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, 5, 11));
        board.burn(11);
        assertEq(token.allowance(ALICE, address(board)), 11);
        assertEq(board.lifetimeOf(ALICE), 0);
        assertEq(board.seasonTotalOf(0, ALICE), 0);
        assertEq(board.totalBurned(), 10);
        _assertBoth(0, BOB, 10);
        _assertBoth(1, address(0), 0);
    }

    function test_cannotSpendAnotherHoldersApproval() public {
        _fund(ALICE, 10);
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(board), 0, 10));
        board.burn(10);
        _assertFailedBurnState();
        assertEq(token.balanceOf(ALICE), 10);
    }

    function test_rejectsETHAndUnknownCalls() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(board).call{value: 1}("");
        assertFalse(ok);
        (ok,) = address(board).call{value: 1}(abi.encodeCall(board.burn, (1)));
        assertFalse(ok);
        (ok,) = address(board).call{value: 1}(abi.encodeCall(board.sweep, ()));
        assertFalse(ok);
        (ok,) = address(board).call(abi.encodeWithSignature("initialize(address)", ALICE));
        assertFalse(ok);
        (ok,) = address(board).call(abi.encodeWithSignature("transferOwnership(address)", ALICE));
        assertFalse(ok);
        assertEq(address(board).balance, 0);
        bytes memory initCode = abi.encodePacked(type(BurnLeaderboard).creationCode, abi.encode(address(token)));
        address deployed;
        assembly ("memory-safe") {
            deployed := create(1, add(initCode, 32), mload(initCode))
        }
        assertEq(deployed, address(0), "constructor accepted ETH");
    }

    function test_gasBoundIndependentOfParticipantAndSeasonHistory() public {
        for (uint256 i; i < 10; ++i) {
            _burn(address(uint160(0x100 + i)), 100 + i);
        }
        uint256 early = _measuredBurn(ALICE, 1000);
        for (uint256 i; i < 160; ++i) {
            _burn(address(uint160(0x200 + i)), 1);
        }
        uint256 late = _measuredBurn(BOB, 1001);
        assertLt(early, 700_000);
        assertLt(late, early + 30_000, "cost grew with participant history");
        vm.warp(board.deployTimestamp() + 1000 * 7 days);
        uint256 freshSeason = _measuredBurn(CAROL, 1002);
        assertLt(freshSeason, 700_000, "cost grew with elapsed seasons");
    }

    function _measuredBurn(address account, uint256 amount) private returns (uint256 used) {
        _fund(account, amount);
        vm.cool(address(board));
        vm.cool(address(token));
        vm.prank(account);
        uint256 beforeGas = gasleft();
        board.burn(amount);
        used = beforeGas - gasleft();
        assertEq(token.balanceOf(address(board)), 0);
    }

    function _fund(address account, uint256 amount) private {
        token.transfer(account, amount);
        vm.prank(account);
        token.approve(address(board), type(uint256).max);
    }

    function _burn(address account, uint256 amount) private {
        _fund(account, amount);
        vm.prank(account);
        board.burn(amount);
        assertEq(token.balanceOf(address(board)), 0);
    }

    function _assertFailedBurnState() private view {
        assertEq(board.totalBurned(), 0);
        assertEq(board.lifetimeOf(ALICE), 0);
        assertEq(board.seasonTotalOf(0, ALICE), 0);
        assertEq(token.balanceOf(DEAD), 0);
        assertEq(token.balanceOf(address(board)), 0);
        _assertEmpty(board.topAllTime());
        _assertEmpty(board.topSeason(0));
    }

    function _assertBoth(uint256 rank, address account, uint256 total) private view {
        BurnLeaderboard.Entry[10] memory allTime = board.topAllTime();
        BurnLeaderboard.Entry[10] memory season = board.topSeason(board.currentSeason());
        assertEq(allTime[rank].account, account);
        assertEq(allTime[rank].total, total);
        assertEq(season[rank].account, account);
        assertEq(season[rank].total, total);
    }

    function _assertEmpty(BurnLeaderboard.Entry[10] memory entries) private pure {
        for (uint256 i; i < 10; ++i) {
            assertEq(entries[i].account, address(0));
            assertEq(entries[i].total, 0);
        }
    }
}
