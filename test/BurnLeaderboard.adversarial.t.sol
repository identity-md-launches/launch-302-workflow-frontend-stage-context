// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BurnLeaderboard} from "../src/BurnLeaderboard.sol";

/// @dev Test-only adversarial dependency, never used as the production launch token.
contract AdversarialToken is ERC20 {
    enum Mode {
        Normal,
        FalseReturn,
        RevertTransfer,
        NoReturn,
        Reenter
    }

    Mode public mode;
    address public target;
    bytes public callback;
    bool public callbackSucceeded;
    bytes public callbackResult;

    error TransferRejected();

    constructor() ERC20("Mock", "MOCK") {
        _mint(msg.sender, 1000 ether);
    }

    function configure(Mode mode_, address target_, bytes calldata callback_) external {
        mode = mode_;
        target = target_;
        callback = callback_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        return _afterTransfer();
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        return _afterTransfer();
    }

    function _afterTransfer() private returns (bool) {
        if (mode == Mode.FalseReturn) return false;
        if (mode == Mode.RevertTransfer) revert TransferRejected();
        if (mode == Mode.NoReturn) {
            assembly ("memory-safe") {
                return(0, 0)
            }
        }
        if (mode == Mode.Reenter) {
            (callbackSucceeded, callbackResult) = target.call(callback);
        }
        return true;
    }
}

contract BurnLeaderboardAdversarialTest is Test {
    AdversarialToken private token;
    BurnLeaderboard private board;
    address private constant ALICE = address(0xA11CE);

    function setUp() public {
        token = new AdversarialToken();
        board = new BurnLeaderboard(address(token));
        token.transfer(ALICE, 100);
        vm.prank(ALICE);
        token.approve(address(board), 100);
    }

    function test_falseTransferFromRollsBackTokenAndRankingEffects() public {
        token.configure(AdversarialToken.Mode.FalseReturn, address(0), "");
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        board.burn(10);
        _assertFailedBurn();
    }

    function test_revertingTransferFromRollsBackAccounting() public {
        token.configure(AdversarialToken.Mode.RevertTransfer, address(0), "");
        vm.prank(ALICE);
        vm.expectRevert(AdversarialToken.TransferRejected.selector);
        board.burn(10);
        _assertFailedBurn();
    }

    function test_optionalReturnTokenSupportedForBurnAndSweep() public {
        token.transfer(address(board), 5);
        token.configure(AdversarialToken.Mode.NoReturn, address(0), "");
        vm.prank(ALICE);
        board.burn(10);
        board.sweep();
        assertEq(token.balanceOf(address(board)), 0);
        assertEq(token.balanceOf(board.DEAD()), 15);
        assertEq(board.totalBurned(), 10);
        assertEq(board.lifetimeOf(ALICE), 10);
    }

    function test_falseSweepRollsBackTransferAndCanBeRetried() public {
        token.transfer(address(board), 5);
        token.configure(AdversarialToken.Mode.FalseReturn, address(0), "");
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token)));
        board.sweep();
        assertEq(token.balanceOf(address(board)), 5);
        assertEq(token.balanceOf(board.DEAD()), 0);
        assertEq(board.totalBurned(), 0);
        token.configure(AdversarialToken.Mode.Normal, address(0), "");
        board.sweep();
        assertEq(token.balanceOf(address(board)), 0);
        assertEq(token.balanceOf(board.DEAD()), 5);
    }

    function test_revertingSweepPreservesDonation() public {
        token.transfer(address(board), 5);
        token.configure(AdversarialToken.Mode.RevertTransfer, address(0), "");
        vm.expectRevert(AdversarialToken.TransferRejected.selector);
        board.sweep();
        assertEq(token.balanceOf(address(board)), 5);
        assertEq(token.balanceOf(board.DEAD()), 0);
        assertEq(board.totalBurned(), 0);
    }

    function test_reentrancyBurnToBurnIsRejected() public {
        _burnWithCallback(abi.encodeCall(board.burn, (1)));
    }

    function test_reentrancyBurnToSweepIsRejected() public {
        _burnWithCallback(abi.encodeCall(board.sweep, ()));
    }

    function test_reentrancySweepToBurnIsRejected() public {
        _sweepWithCallback(abi.encodeCall(board.burn, (1)));
    }

    function test_reentrancySweepToSweepIsRejected() public {
        _sweepWithCallback(abi.encodeCall(board.sweep, ()));
    }

    function _burnWithCallback(bytes memory callback) private {
        token.configure(AdversarialToken.Mode.Reenter, address(board), callback);
        vm.prank(ALICE);
        board.burn(10);
        _assertCallbackRejected();
        assertEq(board.totalBurned(), 10);
        assertEq(board.lifetimeOf(ALICE), 10);
        assertEq(board.lifetimeOf(address(token)), 0);
        assertEq(board.seasonTotalOf(0, ALICE), 10);
        assertEq(board.topAllTime()[0].account, ALICE);
        assertEq(board.topAllTime()[1].account, address(0));
        assertEq(board.topSeason(0)[0].account, ALICE);
        assertEq(board.topSeason(0)[1].account, address(0));
        assertEq(token.balanceOf(board.DEAD()), 10);
        assertEq(token.balanceOf(address(board)), 0);
    }

    function _sweepWithCallback(bytes memory callback) private {
        token.transfer(address(board), 5);
        token.configure(AdversarialToken.Mode.Reenter, address(board), callback);
        board.sweep();
        _assertCallbackRejected();
        assertEq(board.totalBurned(), 0);
        assertEq(board.lifetimeOf(address(token)), 0);
        assertEq(token.balanceOf(board.DEAD()), 5);
        assertEq(token.balanceOf(address(board)), 0);
    }

    function _assertCallbackRejected() private view {
        assertFalse(token.callbackSucceeded());
        assertEq(token.callbackResult(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
    }

    function _assertFailedBurn() private view {
        assertEq(board.totalBurned(), 0);
        assertEq(board.lifetimeOf(ALICE), 0);
        assertEq(board.seasonTotalOf(0, ALICE), 0);
        assertEq(board.topAllTime()[0].account, address(0));
        assertEq(board.topSeason(0)[0].account, address(0));
        assertEq(token.balanceOf(ALICE), 100);
        assertEq(token.allowance(ALICE, address(board)), 100);
        assertEq(token.balanceOf(board.DEAD()), 0);
        assertEq(token.balanceOf(address(board)), 0);
    }
}
