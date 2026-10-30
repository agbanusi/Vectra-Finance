// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {IIndexVault} from "../../src/interfaces/IIndexVault.sol";
import {IndexVault} from "../../src/IndexVault.sol";

/// @notice FIFO redemption queue: lifecycle, partial fills, cancellation, expiry and reserve accounting.
contract RedemptionQueueTest is TestBase {
    address internal adapterA;
    address internal adapterB;

    function setUp() public override {
        super.setUp();
        _zeroFees(); // isolate queue maths from fee dilution
        (adapterA, adapterB) = _setupTwoAdapters();
    }

    function _status(uint256 id) internal view returns (IIndexVault.RequestStatus) {
        return index.redemptionRequest(id).status;
    }

    function test_FullRedeemQueuesWhenIlliquid() public {
        uint256 shares = _deposit(alice, 100e18);
        (uint256 assetsOut, uint256 id) = _redeem(alice, shares, true);

        assertEq(assetsOut, 0);
        assertEq(id, 1);
        assertEq(index.reservedShares(), shares);
        assertEq(index.pendingRequests(), 1);
        assertEq(index.balanceOf(alice), 0, "shares escrowed");
        assertEq(index.balanceOf(address(index)), shares, "vault holds escrow");
        assertEq(uint8(_status(id)), uint8(IIndexVault.RequestStatus.PENDING));
        assertEq(index.availableLiquidity(), 0, "buffer now owed to the queue");
    }

    function test_ProcessAfterRebalancePaysFullClaim() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);

        vm.prank(keeper);
        (uint256 raised,) = index.rebalance(10);
        assertEq(raised, 90e18, "raises everything the queue is owed");

        uint256 processed = index.processRedemptions(10);
        assertEq(processed, 1);
        assertEq(uint8(_status(id)), uint8(IIndexVault.RequestStatus.FULFILLED));
        assertEq(baseToken.balanceOf(alice), 100e18);
        assertEq(index.totalSupply(), 0);
        assertEq(index.reservedShares(), 0);
        assertEq(index.pendingRequests(), 0);
        assertEq(index.headRequestId(), 2, "head advanced past finalised request");
    }

    function test_RebalanceRaisesQueueShortfallPlusBuffer() public {
        _deposit(alice, 50e18);
        uint256 bobShares = _deposit(bob, 50e18);
        _redeem(bob, bobShares, true); // owed 50, balance 10

        vm.prank(keeper);
        (uint256 raised,) = index.rebalance(10);
        // Target = reserved(50) + 10% of remaining NAV(50) = 55; balance was 10.
        assertEq(raised, 45e18);
        assertEq(baseToken.balanceOf(address(index)), 55e18);
    }

    function test_QueueFIFOOrder() public {
        uint256 aShares = _deposit(alice, 50e18);
        uint256 bShares = _deposit(bob, 50e18);
        (, uint256 id1) = _redeem(alice, aShares, true);
        (, uint256 id2) = _redeem(bob, bShares, true);
        assertLt(id1, id2);

        // Raise just enough for alice's request.
        vm.prank(keeper);
        index.pullFromAdapter(adapterA, 40e18);
        index.processRedemptions(10);

        assertEq(uint8(_status(id1)), uint8(IIndexVault.RequestStatus.FULFILLED), "first in, first out");
        assertEq(baseToken.balanceOf(alice), 50e18);
        assertEq(baseToken.balanceOf(bob), 0, "bob waits");
        assertEq(index.headRequestId(), id2);
    }

    function test_InstantRedeemCannotJumpQueue() public {
        _deposit(alice, 50e18);
        uint256 bShares = _deposit(bob, 50e18);
        _redeem(bob, bShares, true);

        // 10e18 base sits in the vault but is owed to bob's request.
        assertEq(baseToken.balanceOf(address(index)), 10e18);
        vm.prank(alice);
        vm.expectRevert();
        index.redeem(1e18, 0, false, alice);
    }

    function test_PartialFill() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);

        index.processRedemptions(10); // only the 10e18 buffer is available

        IIndexVault.RedemptionRequest memory req = index.redemptionRequest(id);
        assertEq(uint8(req.status), uint8(IIndexVault.RequestStatus.PARTIALLY_FILLED));
        assertEq(req.assetsPaid, 10e18);
        assertEq(req.shares, shares - 10e18);
        assertEq(index.reservedShares(), shares - 10e18);
        assertEq(index.pendingRequests(), 1, "still pending");

        vm.prank(keeper);
        index.rebalance(10);
        index.processRedemptions(10);
        req = index.redemptionRequest(id);
        assertEq(uint8(req.status), uint8(IIndexVault.RequestStatus.FULFILLED));
        assertEq(req.assetsPaid, 100e18);
        assertEq(baseToken.balanceOf(alice), 100e18);
    }

    function test_PartialFillNeverOverpaysPerShare() public {
        // Make NAV/share non-integer so rounding matters.
        uint256 shares = _deposit(alice, 100e18);
        baseToken.mint(address(index), 1e18 + 7);
        (, uint256 id) = _redeem(alice, shares, true);

        uint256 navBefore = index.totalNav();
        uint256 supplyBefore = index.totalSupply();
        index.processRedemptions(1);

        IIndexVault.RedemptionRequest memory req = index.redemptionRequest(id);
        uint256 burned = shares - req.shares;
        assertLe(req.assetsPaid, burned * navBefore / supplyBefore, "paid <= fair value of burned shares");
    }

    function test_PartialFillsDisabledWaitsForFullLiquidity() public {
        // Strict FIFO when partial fills are off: an under-funded request blocks those behind it.
        vm.prank(curator);
        index.setLimits(1e15, 1e15, 7 days, 100, false);
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);

        assertEq(index.processRedemptions(10), 0);
        assertEq(uint8(_status(id)), uint8(IIndexVault.RequestStatus.PENDING));
    }

    function test_UnmetFloorIsSkippedNotBlocking() public {
        uint256 aShares = _deposit(alice, 50e18);
        uint256 bShares = _deposit(bob, 50e18);
        vm.prank(alice);
        (, uint256 aliceId) = index.redeem(aShares, 50e18, true, alice); // floor == current claim
        (, uint256 bobId) = _redeem(bob, bShares, true);

        vaultA.setLossBps(1000); // NAV/share drops below alice's floor
        vm.prank(keeper);
        index.rebalance(10);
        assertEq(index.processRedemptions(10), 1, "bob is paid; alice's floor protects her");
        assertEq(uint8(_status(aliceId)), uint8(IIndexVault.RequestStatus.PENDING));
        assertEq(uint8(_status(bobId)), uint8(IIndexVault.RequestStatus.FULFILLED));
        assertEq(index.headRequestId(), aliceId, "head stays on the open request");

        vm.prank(alice);
        index.cancelRedemption(aliceId, address(0));
        assertEq(index.balanceOf(alice), aShares);
    }

    function test_FloorScalesWithPartialFills() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        (, uint256 id) = index.redeem(shares, 99e18, true, alice);

        index.processRedemptions(10); // 10e18 buffer → partial fill
        IIndexVault.RedemptionRequest memory req = index.redemptionRequest(id);
        assertEq(uint8(req.status), uint8(IIndexVault.RequestStatus.PARTIALLY_FILLED));
        assertEq(req.minAssetsOut, 99e18 * req.shares / shares, "floor scaled to remaining shares");

        vm.prank(keeper);
        index.rebalance(10);
        index.processRedemptions(10);
        assertEq(uint8(_status(id)), uint8(IIndexVault.RequestStatus.FULFILLED), "remainder still fillable");
        assertEq(baseToken.balanceOf(alice), 100e18);
    }

    function test_PartialFillsDisabledKeepsStrictFifo() public {
        vm.prank(curator);
        index.setLimits(1e15, 1e15, 7 days, 100, false);
        uint256 aShares = _deposit(alice, 90e18);
        uint256 bShares = _deposit(bob, 10e18);
        (, uint256 aliceId) = _redeem(alice, aShares, true);
        vm.prank(bob);
        (, uint256 bobId) = index.redeem(bShares / 2, 0, true, bob);

        // 10e18 liquid: enough for bob's 5e18 but not alice's 90e18. Bob must not jump ahead.
        assertEq(index.processRedemptions(10), 0);
        assertEq(uint8(_status(aliceId)), uint8(IIndexVault.RequestStatus.PENDING));
        assertEq(uint8(_status(bobId)), uint8(IIndexVault.RequestStatus.PENDING));
    }

    function test_ProcessingVisitsAreBounded() public {
        vm.prank(curator);
        index.setLimits(1e15, 1e15, 7 days, 1000, true);
        _deposit(alice, 100e18);
        // 20 requests whose floors can never be met right now.
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(alice);
            index.redeem(1e18, 1e18, true, alice);
        }
        vaultA.setLossBps(100);
        uint256 gasBefore = gasleft();
        assertEq(index.processRedemptions(5), 0);
        assertLt(gasBefore - gasleft(), 400_000, "visits bounded by maxRequests");
    }

    function test_CancelRedemption() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);

        vm.prank(alice);
        index.cancelRedemption(id, address(0));

        assertEq(uint8(_status(id)), uint8(IIndexVault.RequestStatus.CANCELLED));
        assertEq(index.reservedShares(), 0);
        assertEq(index.pendingRequests(), 0);
        assertEq(index.balanceOf(alice), shares);
        assertEq(index.headRequestId(), 2);
    }

    function test_CancelAfterPartialFillReturnsRemainder() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);
        index.processRedemptions(1);

        vm.prank(alice);
        index.cancelRedemption(id, address(0));
        assertEq(index.balanceOf(alice), shares - 10e18);
        assertEq(baseToken.balanceOf(alice), 10e18);
    }

    function test_CannotCancelTwiceOrAfterFill() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);
        vm.startPrank(alice);
        index.cancelRedemption(id, address(0));
        vm.expectRevert(IndexVault.InvalidRequestStatus.selector);
        index.cancelRedemption(id, address(0));
        vm.stopPrank();
    }

    function test_CancelRedemptionOnlyOwner() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);
        vm.prank(bob);
        vm.expectRevert(IndexVault.NotRequestOwner.selector);
        index.cancelRedemption(id, bob);
    }

    function test_ExpireRedemption() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);

        vm.expectRevert(IndexVault.RequestNotExpired.selector);
        index.expireRedemption(id);

        _warpToExpiry(id);
        assertEq(index.processRedemptions(10), 0, "expired requests are never paid");

        vm.prank(bob); // permissionless
        index.expireRedemption(id);
        assertEq(uint8(_status(id)), uint8(IIndexVault.RequestStatus.EXPIRED));
        assertEq(index.balanceOf(alice), shares, "shares returned to owner, not caller");
        assertEq(index.reservedShares(), 0);

        vm.expectRevert(IndexVault.InvalidRequestStatus.selector);
        index.expireRedemption(id);
    }

    function test_QueueFullReverts() public {
        vm.prank(curator);
        index.setLimits(1e15, 1e15, 7 days, 3, true);
        _deposit(alice, 100e18);
        for (uint256 i = 0; i < 3; i++) {
            _redeem(alice, 20e18, true);
        }
        assertEq(index.pendingRequests(), 3);
        vm.prank(alice);
        vm.expectRevert(IndexVault.QueueFull.selector);
        index.redeem(20e18, 0, true, alice);
    }

    function test_NewDepositCannotConsumeReservedAssets() public {
        uint256 aShares = _deposit(alice, 100e18);
        _redeem(alice, aShares, true);
        uint256 reservedBefore = index.reservedAssets();

        _deposit(bob, 50e18);
        assertEq(index.reservedAssets(), reservedBefore, "reservation unchanged by deposits");
        // Bob's deposit is partly invested but cannot reduce the base owed to alice below its
        // pre-deposit level.
        assertGe(baseToken.balanceOf(address(index)), 10e18);
    }

    function test_ProcessRedemptionsIsBoundedByMaxRequests() public {
        _deposit(alice, 100e18);
        for (uint256 i = 0; i < 5; i++) {
            _redeem(alice, 15e18, true);
        }
        vm.prank(keeper);
        index.rebalance(10);
        assertEq(index.processRedemptions(2), 2);
        assertEq(index.processRedemptions(10), 3);
        assertEq(index.pendingRequests(), 0);
    }

    function test_RedeemPausedBlocksNewRequestsButQueueStillProcesses() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares / 2, true);

        vm.prank(guardian);
        index.setRedemptionsPaused(true);
        vm.prank(alice);
        vm.expectRevert(IndexVault.RedemptionsPaused.selector);
        index.redeem(shares / 2, 0, true, alice);

        vm.prank(keeper);
        index.rebalance(10);
        index.processRedemptions(10);
        assertEq(uint8(_status(id)), uint8(IIndexVault.RequestStatus.FULFILLED));
    }

    function test_RedemptionPaysAtFillTimeNav() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares / 2, true);

        // Yield accrues while queued; the queued holder shares in it equally.
        baseToken.mint(address(index), 10e18);
        vm.prank(keeper);
        index.rebalance(10);
        index.processRedemptions(10);
        assertEq(index.redemptionRequest(id).assetsPaid, 55e18);
    }

    function test_DoubleSpendPrevention() public {
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);

        vm.prank(alice);
        vm.expectRevert(IndexVault.InsufficientShares.selector);
        index.redeem(shares, 0, true, alice);

        vm.prank(alice);
        vm.expectRevert(); // escrowed shares cannot be transferred out by the owner
        index.transfer(bob, shares);

        vm.prank(keeper);
        index.rebalance(10);
        index.processRedemptions(10);
        uint256 paid = baseToken.balanceOf(alice);
        index.processRedemptions(10);
        assertEq(baseToken.balanceOf(alice), paid, "no duplicate fill");

        vm.prank(alice);
        vm.expectRevert(IndexVault.InvalidRequestStatus.selector);
        index.cancelRedemption(id, address(0));
    }

    function test_RebalancePreservesWeights() public {
        // Uneven 70/30 weights so a sequential pull would visibly skew them.
        address[] memory a = new address[](2);
        a[0] = adapterA;
        a[1] = adapterB;
        uint16[] memory w = new uint16[](2);
        w[0] = 7000;
        w[1] = 3000;
        _setWeights(a, w);
        uint256 aShares = _deposit(alice, 100e18); // A=63, B=27, liquid=10
        _deposit(bob, 100e18);
        _redeem(alice, aShares, true);

        vm.prank(keeper);
        index.rebalance(10);
        uint256 inA = vaultA.totalAssets();
        uint256 inB = vaultB.totalAssets();
        assertApproxEqRel(inA * 10_000 / (inA + inB), 7000, 0.001e18, "70/30 split preserved");
    }
}
