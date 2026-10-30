// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TestBase} from "../TestBase.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
import {IndexVault} from "../../src/IndexVault.sol";
import {IIndexVault} from "../../src/interfaces/IIndexVault.sol";

/// @notice Drives random sequences of user, keeper and market actions against one index.
contract IndexHandler is Test {
    IndexVault public index;
    MockERC20 public base;
    MockERC4626 public vaultA;
    address public keeper;
    address[] public actors;

    uint256 public ghostDeposited;
    uint256 public ghostPaidOut;
    uint256 public ghostYield;
    mapping(uint256 => uint256) public ghostPaidPerRequest;

    constructor(IndexVault index_, MockERC20 base_, MockERC4626 vaultA_, address keeper_, address[] memory actors_) {
        index = index_;
        base = base_;
        vaultA = vaultA_;
        keeper = keeper_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function deposit(uint256 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        amount = bound(amount, 1e15, 1e24);
        base.mint(actor, amount);
        vm.startPrank(actor);
        base.approve(address(index), amount);
        index.deposit(amount, 0, actor);
        vm.stopPrank();
        ghostDeposited += amount;
    }

    function redeem(uint256 actorSeed, uint256 fraction, bool allowQueue) external {
        address actor = _actor(actorSeed);
        uint256 balance = index.balanceOf(actor);
        if (balance < 1e15) return;
        uint256 shares = bound(fraction, 1e15, balance);
        uint256 before = base.balanceOf(actor);
        vm.prank(actor);
        try index.redeem(shares, 0, allowQueue, actor) {
            ghostPaidOut += base.balanceOf(actor) - before;
        } catch {}
    }

    function process(uint256 maxRequests) external {
        maxRequests = bound(maxRequests, 1, 20);
        uint256 head = index.headRequestId();
        uint256 next = index.nextRequestId();
        uint256[] memory paidBefore = new uint256[](next - head);
        for (uint256 id = head; id < next; id++) {
            paidBefore[id - head] = index.redemptionRequest(id).assetsPaid;
        }
        uint256 vaultBefore = base.balanceOf(address(index));
        index.processRedemptions(maxRequests);
        for (uint256 id = head; id < next; id++) {
            ghostPaidPerRequest[id] += index.redemptionRequest(id).assetsPaid - paidBefore[id - head];
        }
        uint256 vaultAfter = base.balanceOf(address(index));
        ghostPaidOut += vaultBefore - vaultAfter;
    }

    function rebalance(uint256 maxActions) external {
        vm.prank(keeper);
        index.rebalance(bound(maxActions, 1, 4));
    }

    function cancel(uint256 actorSeed, uint256 idSeed) external {
        uint256 next = index.nextRequestId();
        if (next <= 1) return;
        uint256 id = 1 + (idSeed % (next - 1));
        IIndexVault.RedemptionRequest memory req = index.redemptionRequest(id);
        address actor = req.owner == address(0) ? _actor(actorSeed) : req.owner;
        vm.prank(actor);
        try index.cancelRedemption(id, address(0)) {} catch {}
    }

    function expire(uint256 idSeed) external {
        uint256 next = index.nextRequestId();
        if (next <= 1) return;
        try index.expireRedemption(1 + (idSeed % (next - 1))) {} catch {}
    }

    function yieldOnA(uint256 amount) external {
        if (vaultA.totalSupply() == 0) return;
        amount = bound(amount, 0, vaultA.totalAssets() / 100);
        base.mint(address(vaultA), amount);
        ghostYield += amount;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 3 days));
    }
}

/// @notice Core accounting invariants of the index under random action sequences.
contract IndexInvariantsTest is TestBase {
    IndexHandler internal handler;
    address[] internal actors;

    function setUp() public override {
        super.setUp();
        _zeroFees(); // value-conservation ghost maths assumes no fee dilution
        _setupTwoAdapters();
        actors.push(alice);
        actors.push(bob);
        actors.push(carol);
        handler = new IndexHandler(index, baseToken, vaultA, keeper, actors);
        targetContract(address(handler));
    }

    /// Escrowed shares are exactly the shares held by the vault itself.
    function invariant_EscrowMatchesReservedShares() public view {
        assertEq(index.balanceOf(address(index)), index.reservedShares());
    }

    /// The sum of open request balances equals reserved shares; closed requests hold nothing.
    function invariant_OpenRequestsSumToReserved() public view {
        uint256 sum;
        uint256 open;
        uint256 next = index.nextRequestId();
        for (uint256 id = 1; id < next; id++) {
            IIndexVault.RedemptionRequest memory req = index.redemptionRequest(id);
            bool isOpen = req.status == IIndexVault.RequestStatus.PENDING
                || req.status == IIndexVault.RequestStatus.PARTIALLY_FILLED;
            if (isOpen) {
                sum += req.shares;
                open++;
            } else {
                assertEq(req.shares, 0, "closed request still holds shares");
            }
        }
        assertEq(sum, index.reservedShares());
        assertEq(open, index.pendingRequests());
    }

    /// Supply is fully accounted for by holders and escrow.
    function invariant_SupplyAccounted() public view {
        uint256 sum = index.balanceOf(address(index)) + index.balanceOf(feeRecipient);
        for (uint256 i = 0; i < actors.length; i++) {
            sum += index.balanceOf(actors[i]);
        }
        assertEq(sum, index.totalSupply());
    }

    /// Value is conserved: deposits + yield − payouts == NAV (up to per-operation rounding).
    function invariant_ValueConserved() public view {
        uint256 expected = handler.ghostDeposited() + handler.ghostYield() - handler.ghostPaidOut();
        assertApproxEqAbs(index.totalNav(), expected, 1e6, "value created or destroyed");
    }

    /// Each request is paid at most once in total and never more than its recorded amount.
    function invariant_NoDoublePayment() public view {
        uint256 next = index.nextRequestId();
        for (uint256 id = 1; id < next; id++) {
            assertEq(handler.ghostPaidPerRequest(id), index.redemptionRequest(id).assetsPaid);
        }
    }

    /// Head pointer never skips an open request.
    function invariant_HeadNeverSkipsOpenRequests() public view {
        uint256 head = index.headRequestId();
        for (uint256 id = 1; id < head; id++) {
            IIndexVault.RequestStatus s = index.redemptionRequest(id).status;
            assertTrue(s != IIndexVault.RequestStatus.PENDING && s != IIndexVault.RequestStatus.PARTIALLY_FILLED);
        }
    }

    /// Shares outstanding always have backing: if supply > 0 then NAV > 0.
    function invariant_NoUnbackedShares() public view {
        if (index.totalSupply() > 0) assertGt(index.totalNav(), 0);
    }
}
