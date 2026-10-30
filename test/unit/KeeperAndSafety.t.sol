// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {MockAdapter} from "../mocks/MockAdapter.sol";
import {IndexVault} from "../../src/IndexVault.sol";
import {IndexLens} from "../../src/periphery/IndexLens.sol";

/// @notice Keeper-only liquidity operations, malicious adapters, reentrancy and quarantine.
contract KeeperAndSafetyTest is TestBase {
    MockAdapter internal mockA;
    MockAdapter internal mockB;

    function setUp() public override {
        super.setUp();
        _zeroFees();
        mockA = MockAdapter(_deployAdapter(MOCK_KIND, address(vaultA)));
        mockB = MockAdapter(_deployAdapter(MOCK_KIND, address(vaultB)));
        address[] memory a = new address[](2);
        a[0] = address(mockA);
        a[1] = address(mockB);
        uint16[] memory w = new uint16[](2);
        w[0] = 5000;
        w[1] = 5000;
        _setWeights(a, w);
    }

    function test_PullFromAdapterOnlyKeeper() public {
        _deposit(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert();
        index.pullFromAdapter(address(mockA), 1e18);

        vm.prank(keeper);
        uint256 got = index.pullFromAdapter(address(mockA), 10e18);
        assertEq(got, 10e18);
    }

    function test_PullFromUnknownAdapterReverts() public {
        vm.prank(keeper);
        vm.expectRevert(IndexVault.AdapterMismatch.selector);
        index.pullFromAdapter(address(vaultA), 1e18);
    }

    function test_PushToAdapterBoundedByTargetAndBuffer() public {
        _deposit(alice, 100e18); // 45/45 invested, 10 liquid
        vm.prank(keeper);
        index.pullFromAdapter(address(mockA), 20e18); // A=25, liquid=30

        // Buffer target is 10, so 20 is free; A target is 45 (+5 tolerance).
        vm.prank(keeper);
        vm.expectRevert();
        index.pushToAdapter(address(mockA), 21e18);

        vm.prank(keeper);
        index.pushToAdapter(address(mockA), 20e18);
        assertEq(mockA.reportedAssets(), 45e18);

        vm.prank(keeper);
        index.pullFromAdapter(address(mockB), 45e18); // liquid 55, B=0
        vm.prank(keeper);
        vm.expectRevert(IndexVault.ExceedsTarget.selector);
        index.pushToAdapter(address(mockA), 10e18); // A would be 55 > 50 cap
    }

    function test_PushCannotSpendQueueReservation() public {
        uint256 shares = _deposit(alice, 100e18);
        _redeem(alice, shares / 2, true); // owes 50, holds 10
        vm.prank(keeper);
        vm.expectRevert();
        index.pushToAdapter(address(mockA), 1e18);
    }

    function test_FailingAdapterDepositKeepsFundsLiquid() public {
        mockA.setFailDeposit(true);
        uint256 shares = _deposit(alice, 100e18);
        assertEq(shares, 100e18);
        assertEq(mockA.reportedAssets(), 0);
        assertEq(mockB.reportedAssets(), 45e18);
        assertEq(index.totalNav(), 100e18, "no value lost");
    }

    function test_UnhealthyAdapterSkipped() public {
        mockA.setHealthy(false);
        _deposit(alice, 100e18);
        assertEq(mockA.reportedAssets(), 0);
    }

    function test_VaultTrustsBalanceDeltaNotAdapterReturn() public {
        _deposit(alice, 100e18);
        mockA.setLieAboutWithdraw(true, 5000); // reports huge amount, delivers half
        vm.prank(keeper);
        uint256 got = index.pullFromAdapter(address(mockA), 10e18);
        assertEq(got, 5e18, "only the actual balance delta is credited");
    }

    function test_AdapterReentrancyBlocked() public {
        _deposit(alice, 50e18);
        baseToken.mint(address(mockA), 0);
        mockA.setReentrancy(abi.encodeCall(IndexVault.processRedemptions, (10)));
        _deposit(bob, 50e18); // allocation calls mockA.deposit, which tries to re-enter
        assertFalse(mockA.reentrySucceeded(), "nonReentrant blocks adapter callbacks");
    }

    function test_RevertingValuationCanBeQuarantined() public {
        uint256 shares = _deposit(alice, 100e18);
        mockA.setFailTotalAssets(true);

        // A broken valuation freezes the index...
        vm.prank(alice);
        vm.expectRevert();
        index.redeem(1e18, 0, false, alice);

        // ...the lens still reports it without reverting...
        IndexLens.IndexView memory v = lens.getIndex(index);
        assertFalse(v.navHealthy);

        // ...guardian/curator cannot write it off; only the admin can.
        vm.prank(curator);
        vm.expectRevert();
        index.setAdapterQuarantined(address(mockA), true);
        vm.prank(admin);
        index.setAdapterQuarantined(address(mockA), true);

        assertTrue(index.depositsPaused(), "no buying in at a written-down NAV");
        assertEq(index.totalNav(), 55e18);
        (uint256 out,) = _redeem(alice, shares / 10, false);
        assertEq(out, 5.5e18, "exits continue at the conservative NAV");

        // Recovery restores the value to remaining holders.
        mockA.setFailTotalAssets(false);
        vm.prank(admin);
        index.setAdapterQuarantined(address(mockA), false);
        assertEq(index.totalNav(), 94.5e18);
    }

    function test_QuarantinedAdapterCannotBeReweighted() public {
        vm.prank(admin);
        index.setAdapterQuarantined(address(mockA), true);
        address[] memory a = new address[](1);
        a[0] = address(mockA);
        uint16[] memory w = new uint16[](1);
        w[0] = 10_000;
        vm.prank(curator);
        vm.expectRevert(IndexVault.InvalidAdapterState.selector);
        index.setAdapterWeights(a, w);
    }

    function test_RebalanceInvestsExcessBeyondTolerance() public {
        _setWeights(new address[](0), new uint16[](0));
        _deposit(alice, 100e18); // fully liquid

        address[] memory a = new address[](2);
        a[0] = address(mockA);
        a[1] = address(mockB);
        uint16[] memory w = new uint16[](2);
        w[0] = 5000;
        w[1] = 5000;
        _setWeights(a, w);

        vm.prank(keeper);
        (, uint256 allocated) = index.rebalance(10);
        assertEq(allocated, 90e18);
        assertEq(mockA.reportedAssets(), 45e18);
        assertEq(mockB.reportedAssets(), 45e18);
    }

    function test_ProcessRedemptionsIsPermissionlessButCannotRedirect() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);
        vm.prank(keeper);
        index.rebalance(10);

        vm.prank(carol);
        index.processRedemptions(10);
        assertEq(baseToken.balanceOf(alice), 100e18, "paid to recorded receiver");
        assertEq(baseToken.balanceOf(carol), 0);
        assertEq(index.redemptionRequest(id).assetsPaid, 100e18);
    }

    function test_LensReportsDriftTargets() public {
        _deposit(alice, 100e18);
        vm.prank(keeper);
        index.pullFromAdapter(address(mockA), 20e18);
        IndexLens.IndexView memory v = lens.getIndex(index);
        assertEq(v.adapters.length, 2);
        assertEq(v.adapters[0].targetAssets, 45e18);
        assertEq(v.adapters[0].totalAssets, 25e18);
        assertEq(v.availableLiquidity, 30e18);
    }
}
