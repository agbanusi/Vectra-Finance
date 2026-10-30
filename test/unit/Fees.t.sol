// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {FeeManager} from "../../src/fees/FeeManager.sol";

/// @notice Management and performance fee accounting.
contract FeesTest is TestBase {
    function _feeValue() internal view returns (uint256) {
        return index.balanceOf(feeRecipient) * index.totalNav() / index.totalSupply();
    }

    function test_ManagementFeeAccruesOverAYear() public {
        vm.prank(curator);
        index.setFeeConfig(100, 0); // 1%/yr, no performance fee
        _deposit(alice, 100e18);

        vm.warp(block.timestamp + 365 days);
        index.accrueFees();

        // 1% of NAV is minted as shares; their value is slightly under 1% because of dilution.
        assertApproxEqRel(_feeValue(), 0.99e18, 0.01e18);
        assertEq(baseToken.balanceOf(feeRecipient), 0, "fees never move base assets");
        assertEq(index.totalNav(), 100e18, "NAV unchanged by fee accrual");
    }

    function test_PerformanceFeeOnlyOnGainsAboveHighWaterMark() public {
        vm.prank(curator);
        index.setFeeConfig(0, 1000); // 10% of gains
        _deposit(alice, 100e18);
        // Absolute timestamps: via-IR may cache block.timestamp across repeated warps.
        vm.warp(1_000);
        index.accrueFees(); // sets HWM at 1.0
        assertEq(index.balanceOf(feeRecipient), 0, "no gain yet");

        baseToken.mint(address(index), 10e18); // +10% gain
        vm.warp(2_000);
        index.accrueFees();
        assertApproxEqRel(_feeValue(), 1e18, 0.01e18, "10% of the 10e18 gain");

        // A drawdown and recovery to the old HWM charges nothing more.
        uint256 feeShares = index.balanceOf(feeRecipient);
        vm.prank(alice);
        index.redeem(10e18, 0, false, alice);
        vm.warp(3_000);
        index.accrueFees();
        assertEq(index.balanceOf(feeRecipient), feeShares, "no new high, no fee");
    }

    function test_FeeChangeIsNotRetroactive() public {
        _deposit(alice, 100e18);
        vm.warp(block.timestamp + 365 days);
        vm.prank(curator);
        index.setFeeConfig(2000, 0); // raise to 20%, but the past year accrues at 1%
        assertApproxEqRel(_feeValue(), 0.99e18, 0.01e18);
    }

    function test_FeeCapsEnforced() public {
        vm.startPrank(curator);
        vm.expectRevert(FeeManager.FeeTooHigh.selector);
        index.setFeeConfig(2001, 0);
        vm.expectRevert(FeeManager.FeeTooHigh.selector);
        index.setFeeConfig(0, 3001);
        vm.stopPrank();
    }

    function test_FeeRecipientRotationAccruesFirst() public {
        _deposit(alice, 100e18);
        vm.warp(block.timestamp + 365 days);
        vm.prank(curator);
        index.setFeeRecipient(carol);
        assertGt(index.balanceOf(feeRecipient), 0, "old recipient paid up to rotation");
        assertEq(index.balanceOf(carol), 0);
    }

    function test_PreviewFeesMatchesAccrual() public {
        _deposit(alice, 100e18);
        vm.warp(block.timestamp + 30 days);
        (uint256 m, uint256 p) = index.previewFees();
        index.accrueFees();
        assertEq(index.balanceOf(feeRecipient), m + p);
    }

    function test_LensPreviewDepositIncludesPendingFees() public {
        _deposit(alice, 100e18);
        vm.warp(block.timestamp + 365 days);
        uint256 expected = lens.previewDeposit(index, 10e18);
        uint256 actual = _deposit(bob, 10e18);
        assertEq(actual, expected);
    }
}
