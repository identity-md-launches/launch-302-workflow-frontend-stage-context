// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {BurnLeaderboard} from "../src/BurnLeaderboard.sol";

contract FactoryFixture {
    function deploy() external returns (LaunchToken token, BurnLeaderboard board) {
        token = new LaunchToken();
        board = new BurnLeaderboard(address(token));
    }
}

contract LaunchTokenTest is Test {
    LaunchToken private token;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    uint256 private constant SUPPLY = 1_000_000_000 ether;

    function setUp() public {
        token = new LaunchToken();
    }

    function test_metadataAndFixedSupply() public view {
        assertEq(token.name(), "Pyre");
        assertEq(token.symbol(), "PYRE");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(this)), SUPPLY);
    }

    function testFuzz_transferConservesSupply(uint256 amount) public {
        amount = bound(amount, 0, SUPPLY);
        assertTrue(token.transfer(ALICE, amount));
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.balanceOf(address(this)), SUPPLY - amount);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_transferFromUsesAllowanceAndMovesExactAmount() public {
        token.transfer(ALICE, 50 ether);
        vm.prank(ALICE);
        token.approve(address(this), 12 ether);
        assertTrue(token.transferFrom(ALICE, BOB, 10 ether));
        assertEq(token.balanceOf(ALICE), 40 ether);
        assertEq(token.balanceOf(BOB), 10 ether);
        assertEq(token.allowance(ALICE, address(this)), 2 ether);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_infiniteAllowanceRemainsInfinite() public {
        token.transfer(ALICE, 1 ether);
        vm.prank(ALICE);
        token.approve(address(this), type(uint256).max);
        token.transferFrom(ALICE, BOB, 1 ether);
        assertEq(token.allowance(ALICE, address(this)), type(uint256).max);
    }

    function test_insufficientAllowanceReverts() public {
        token.transfer(ALICE, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(this), 0, 1));
        token.transferFrom(ALICE, BOB, 1);
        assertEq(token.balanceOf(ALICE), 1 ether);
        assertEq(token.balanceOf(BOB), 0);
    }

    function test_insufficientBalanceReverts() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, 0, 1));
        token.transfer(BOB, 1);
    }

    function test_zeroRecipientReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1);
    }

    function test_noPrivilegedSelectorsForDeployerOrStranger() public {
        string[10] memory signatures = [
            "mint(address,uint256)",
            "mint(uint256)",
            "mint()",
            "issue(uint256)",
            "setOwner(address)",
            "transferOwnership(address)",
            "upgradeTo(address)",
            "initialize(address)",
            "unpause()",
            "setMinter(address)"
        ];
        for (uint256 i; i < signatures.length; ++i) {
            bytes memory data = abi.encodeWithSignature(signatures[i], ALICE, uint256(100));
            (bool ok,) = address(token).call(data);
            assertFalse(ok);
            vm.prank(ALICE);
            (ok,) = address(token).call(data);
            assertFalse(ok);
        }
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(this)), SUPPLY);
        assertEq(token.balanceOf(ALICE), 0);
    }

    function test_factoryDeploymentPreservesSupplyAndHasNoEscapeOpcodes() public {
        FactoryFixture factory = new FactoryFixture();
        (LaunchToken launched, BurnLeaderboard board) = factory.deploy();
        assertEq(launched.balanceOf(address(factory)), SUPPLY);
        assertEq(launched.totalSupply(), SUPPLY);
        assertEq(launched.balanceOf(address(board)), 0);
        assertEq(address(board.token()), address(launched));
        _checkRuntime(address(launched).code);
        _checkRuntime(address(board).code);
    }

    function _checkRuntime(bytes memory code) private pure {
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden opcode");
        }
    }
}
