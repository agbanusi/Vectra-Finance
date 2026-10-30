// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {IndexVault} from "../../src/IndexVault.sol";
import {AllowlistCompliance, IEligibilityProvider} from "../../src/compliance/AllowlistCompliance.sol";
import {PermissionlessCompliance} from "../../src/compliance/PermissionlessCompliance.sol";
import {IIndexVault} from "../../src/interfaces/IIndexVault.sol";

contract MockEligibilityProvider is IEligibilityProvider {
    mapping(address => bool) public eligible;
    bool public broken;

    function set(address account, bool value) external {
        eligible[account] = value;
    }

    function setBroken(bool value) external {
        broken = value;
    }

    function isEligible(address account, bytes32) external view returns (bool) {
        require(!broken, "provider down");
        return eligible[account];
    }
}

/// @notice Eligibility enforcement on deposits, redemptions, transfers and the redemption queue.
contract ComplianceTest is TestBase {
    AllowlistCompliance internal compliance;
    address internal mallory = makeAddr("mallory"); // never eligible

    function setUp() public override {
        super.setUp();
        compliance = new AllowlistCompliance(keccak256("RWA_POLICY"), admin, address(0));
        vm.startPrank(admin);
        compliance.setEligibility(alice, true, 0);
        compliance.setEligibility(bob, true, 0);
        vm.stopPrank();

        IndexVault.IndexConfig memory cfg = _defaultConfig();
        cfg.name = "Restricted RWA Index";
        cfg.symbol = "vRWA";
        cfg.complianceModule = address(compliance);
        cfg.managementFeeBps = 0;
        cfg.performanceFeeBps = 0;
        index = _createIndex(cfg);
    }

    function _revoke(address account) internal {
        vm.prank(admin);
        compliance.setEligibility(account, false, 0);
    }

    /// @dev Makes the index illiquid so that full redemptions must queue.
    function _makeIlliquid() internal {
        _setupTwoAdapters();
    }

    function test_PolicyString() public view {
        assertEq(lens.getIndex(index).compliancePolicy, "allowlist");
    }

    function test_EligibleDepositSucceeds() public {
        uint256 shares = _deposit(alice, 100e18);
        assertGt(shares, 0);
        assertEq(index.totalNav(), 100e18);
    }

    function test_IneligibleDepositReverts() public {
        _mintAndApprove(mallory, 100e18);
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(AllowlistCompliance.NotEligible.selector, mallory));
        index.deposit(100e18, 0, mallory);
    }

    function test_DepositToIneligibleReceiverReverts() public {
        _mintAndApprove(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllowlistCompliance.NotEligible.selector, mallory));
        index.deposit(100e18, 0, mallory);
    }

    function test_TransferToIneligibleReverts() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllowlistCompliance.NotEligible.selector, mallory));
        index.transfer(mallory, shares);
    }

    function test_TransferFromToIneligibleReverts() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        index.approve(mallory, shares);
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(AllowlistCompliance.NotEligible.selector, mallory));
        index.transferFrom(alice, mallory, shares);
    }

    function test_TransferBetweenEligibleSucceeds() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        index.transfer(bob, shares / 2);
        assertEq(index.balanceOf(bob), shares / 2);
    }

    function test_RevokedHolderCanExitToEligible() public {
        uint256 shares = _deposit(alice, 100e18);
        _revoke(alice);
        vm.prank(alice);
        index.transfer(bob, shares);
        assertEq(index.balanceOf(bob), shares);
    }

    function test_RevokedHolderCannotTransferToIneligible() public {
        uint256 shares = _deposit(alice, 100e18);
        _revoke(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllowlistCompliance.NotEligible.selector, mallory));
        index.transfer(mallory, shares);
    }

    function test_IneligibleRedeemReverts() public {
        uint256 shares = _deposit(alice, 100e18);
        _revoke(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllowlistCompliance.NotEligible.selector, alice));
        index.redeem(shares, 0, false, alice);
    }

    function test_RedeemToEligibleReceiverSucceeds() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        (uint256 out,) = index.redeem(shares / 2, 0, false, bob);
        assertEq(baseToken.balanceOf(bob), out);
        assertEq(out, 50e18);
    }

    function test_RedeemToIneligibleReceiverReverts() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllowlistCompliance.NotEligible.selector, mallory));
        index.redeem(shares / 2, 0, false, mallory);
    }

    function test_QueuedRedemptionBlockedByComplianceIsSkipped() public {
        _makeIlliquid();
        uint256 aShares = _deposit(alice, 50e18);
        uint256 bShares = _deposit(bob, 50e18);
        (, uint256 aliceReq) = _redeem(alice, aShares, true);
        (, uint256 bobReq) = _redeem(bob, bShares, true);
        assertEq(aliceReq, 1);
        assertEq(bobReq, 2);

        _revoke(alice);
        vm.prank(keeper);
        index.rebalance(10);

        vm.expectEmit(true, true, true, true, address(index));
        emit IndexVault.RedemptionPaymentBlocked(aliceReq, alice, alice);
        uint256 processed = index.processRedemptions(10);
        assertEq(processed, 1, "only bob is paid");

        assertEq(uint8(index.redemptionRequest(aliceReq).status), uint8(IIndexVault.RequestStatus.PENDING));
        assertEq(uint8(index.redemptionRequest(bobReq).status), uint8(IIndexVault.RequestStatus.FULFILLED));
        assertEq(baseToken.balanceOf(alice), 0, "revoked holder not paid");
    }

    function test_CancelRedemptionToIneligibleReverts() public {
        _makeIlliquid();
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);
        assertGt(id, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllowlistCompliance.NotEligible.selector, mallory));
        index.cancelRedemption(id, mallory);
    }

    function test_CancelRedemptionToEligibleSucceeds() public {
        _makeIlliquid();
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);
        assertGt(id, 0);

        _revoke(alice); // revoked owner can still route escrow to an eligible address
        vm.prank(alice);
        index.cancelRedemption(id, bob);
        assertEq(index.balanceOf(bob), shares);
    }

    function test_ComplianceModuleMustBeContract() public {
        vm.prank(admin);
        vm.expectRevert(IndexVault.NotAContract.selector);
        index.setCompliance(makeAddr("eoa"));
    }

    function test_CuratorCannotSwapComplianceModule() public {
        PermissionlessCompliance open = new PermissionlessCompliance();
        vm.prank(curator);
        vm.expectRevert();
        index.setCompliance(address(open));
    }

    function test_AttestationExpiry() public {
        vm.prank(admin);
        compliance.setEligibility(alice, true, uint64(block.timestamp + 1 days));
        _deposit(alice, 100e18);

        vm.warp(block.timestamp + 2 days);
        _mintAndApprove(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllowlistCompliance.NotEligible.selector, alice));
        index.deposit(100e18, 0, alice);
    }

    function test_PastExpiryRejected() public {
        vm.warp(10 days);
        vm.prank(admin);
        vm.expectRevert(AllowlistCompliance.InvalidExpiry.selector);
        compliance.setEligibility(alice, true, uint64(block.timestamp - 1));
    }

    function test_OnlyAttestorCanSetEligibility() public {
        vm.prank(mallory);
        vm.expectRevert();
        compliance.setEligibility(mallory, true, 0);
    }

    function test_ExternalProviderGrantsEligibility() public {
        MockEligibilityProvider provider = new MockEligibilityProvider();
        provider.set(carol, true);
        vm.prank(admin);
        compliance.setProvider(address(provider));
        assertTrue(compliance.isEligible(carol));
        _deposit(carol, 10e18);
    }

    function test_BrokenProviderFailsClosed() public {
        MockEligibilityProvider provider = new MockEligibilityProvider();
        provider.set(carol, true);
        provider.setBroken(true);
        vm.prank(admin);
        compliance.setProvider(address(provider));
        assertFalse(compliance.isEligible(carol));
        assertTrue(compliance.isEligible(alice), "local attestations unaffected");
    }

    function test_SwitchingToPermissionless() public {
        PermissionlessCompliance open = new PermissionlessCompliance();
        vm.prank(admin);
        index.setCompliance(address(open));
        _deposit(mallory, 10e18);
        assertEq(lens.getIndex(index).compliancePolicy, "permissionless");
    }
}
