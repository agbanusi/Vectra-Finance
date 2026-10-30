// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Initializable} from "openzeppelin-contracts/contracts/proxy/utils/Initializable.sol";
import {TestBase} from "../TestBase.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockERC4626} from "../mocks/MockERC4626.sol";
import {MockMetaMorpho} from "../mocks/MockMetaMorpho.sol";
import {IndexVault} from "../../src/IndexVault.sol";
import {AdapterRegistry} from "../../src/AdapterRegistry.sol";
import {BaseERC4626Adapter} from "../../src/adapters/BaseERC4626Adapter.sol";
import {ERC4626Adapter} from "../../src/adapters/ERC4626Adapter.sol";
import {IStrategyAdapter} from "../../src/interfaces/IStrategyAdapter.sol";

/// @notice Protocol adapters against faithful ERC-4626 / MetaMorpho mocks, including failure modes.
contract AdaptersTest is TestBase {
    function _single(address adapter) internal {
        address[] memory a = new address[](1);
        a[0] = adapter;
        uint16[] memory w = new uint16[](1);
        w[0] = 10_000;
        _setWeights(a, w);
    }

    function test_AdapterImplementationLocked() public {
        ERC4626Adapter impl = new ERC4626Adapter();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(address(index), address(vaultA), 100);
    }

    function test_OnlyVaultCanMoveAdapterFunds() public {
        address adapter = _deployAdapter(ERC4626_KIND, address(vaultA));
        _single(adapter);
        _deposit(alice, 100e18);

        vm.startPrank(alice);
        vm.expectRevert(BaseERC4626Adapter.NotVault.selector);
        IStrategyAdapter(adapter).withdraw(1e18);
        vm.expectRevert(BaseERC4626Adapter.NotVault.selector);
        IStrategyAdapter(adapter).deposit(1e18);
        vm.stopPrank();
    }

    function test_AdapterValuesPositionAtExchangeRate() public {
        address adapter = _deployAdapter(ERC4626_KIND, address(vaultA));
        _single(adapter);
        _deposit(alice, 100e18);
        assertEq(IStrategyAdapter(adapter).totalAssets(), 90e18);

        baseToken.mint(address(vaultA), 9e18); // +10% share price
        assertEq(IStrategyAdapter(adapter).totalAssets(), 99e18);
        assertEq(index.totalNav(), 109e18);
    }

    function test_SlippageAboveMaxRejectedAtCreation() public {
        vm.prank(curator);
        vm.expectRevert(BaseERC4626Adapter.SlippageExceeded.selector);
        index.deployAdapter(ERC4626_KIND, address(vaultA), 501);
    }

    function test_UnapprovedKindRejected() public {
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(AdapterRegistry.ImplementationNotApproved.selector, keccak256("NOPE")));
        index.deployAdapter(keccak256("NOPE"), address(vaultA), 100);
    }

    function test_RevokedImplementationBlocksNewAdaptersOnly() public {
        address existing = _deployAdapter(ERC4626_KIND, address(vaultA));
        (address impl,) = registry.implementations(ERC4626_KIND);
        vm.prank(admin);
        registry.setImplementation(ERC4626_KIND, impl, false);

        vm.prank(curator);
        vm.expectRevert();
        index.deployAdapter(ERC4626_KIND, address(vaultB), 100);
        assertTrue(registry.isAdapter(existing), "existing adapter unaffected");
    }

    function test_AssetMismatchRejected() public {
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        MockERC4626 otherVault = new MockERC4626(IERC20(address(other)), "Other Vault", "oV");
        _approveTarget(address(otherVault));
        address adapter = _deployAdapter(ERC4626_KIND, address(otherVault));

        address[] memory a = new address[](1);
        a[0] = adapter;
        uint16[] memory w = new uint16[](1);
        w[0] = 10_000;
        vm.prank(curator);
        vm.expectRevert(IndexVault.AdapterMismatch.selector);
        index.setAdapterWeights(a, w);
    }

    function test_UnapprovedTargetRejected() public {
        MockERC4626 rogue = new MockERC4626(IERC20(address(baseToken)), "Rogue", "R");
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(AdapterRegistry.TargetNotApproved.selector, address(rogue)));
        index.deployAdapter(ERC4626_KIND, address(rogue), 100);
    }

    function test_RevokedTargetKeepsExistingAdapterWorking() public {
        address adapter = _deployAdapter(ERC4626_KIND, address(vaultA));
        _single(adapter);
        _deposit(alice, 100e18);
        vm.prank(admin);
        registry.setTargetApproved(address(vaultA), false);

        vm.prank(curator);
        vm.expectRevert();
        index.deployAdapter(ERC4626_KIND, address(vaultA), 100);

        vm.prank(keeper);
        assertEq(index.pullFromAdapter(adapter, 90e18), 90e18, "funds never trapped by revocation");
    }

    function test_OnlyRegistryAdminApprovesTargets() public {
        vm.prank(curator);
        vm.expectRevert();
        registry.setTargetApproved(address(vaultA), true);
    }

    function test_MorphoV11WithBadDebtIsUnhealthy() public {
        MockMetaMorpho mm = new MockMetaMorpho(IERC20(address(baseToken)));
        _approveTarget(address(mm));
        address adapter = _deployAdapter(MORPHO_KIND, address(mm));
        assertTrue(IStrategyAdapter(adapter).isHealthy());

        mm.setLostAssets(1);
        assertFalse(IStrategyAdapter(adapter).isHealthy());

        address[] memory a = new address[](1);
        a[0] = adapter;
        uint16[] memory w = new uint16[](1);
        w[0] = 10_000;
        vm.prank(curator);
        vm.expectRevert(IndexVault.InvalidAdapterState.selector);
        index.setAdapterWeights(a, w);
    }

    function test_MorphoBadDebtAfterOnboardingStopsNewAllocations() public {
        MockMetaMorpho mm = new MockMetaMorpho(IERC20(address(baseToken)));
        _approveTarget(address(mm));
        address adapter = _deployAdapter(MORPHO_KIND, address(mm));
        _single(adapter);
        _deposit(alice, 100e18);
        assertEq(mm.totalAssets(), 90e18);

        mm.setLostAssets(1);
        _deposit(bob, 100e18);
        assertEq(mm.totalAssets(), 90e18, "no new allocation to unhealthy vault");
        assertEq(baseToken.balanceOf(address(index)), 110e18, "funds stay liquid");
    }

    function test_MorphoV10WithoutLostAssetsIsHealthy() public {
        // Plain ERC-4626 mock has no lostAssets(): models MetaMorpho v1.0.
        address adapter = _deployAdapter(MORPHO_KIND, address(vaultA));
        assertTrue(IStrategyAdapter(adapter).isHealthy());
    }

    function test_EulerAdapterSuppliesAndValues() public {
        address adapter = _deployAdapter(EULER_KIND, address(vaultA));
        assertTrue(IStrategyAdapter(adapter).isHealthy());
        _single(adapter);
        _deposit(alice, 100e18);
        assertEq(IStrategyAdapter(adapter).totalAssets(), 90e18);
    }

    function test_DepositCapRespectedRemainderStaysLiquid() public {
        address adapter = _deployAdapter(ERC4626_KIND, address(vaultA));
        _single(adapter);
        vaultA.setDepositCap(30e18);
        _deposit(alice, 100e18);
        assertEq(vaultA.totalAssets(), 30e18);
        assertEq(baseToken.balanceOf(address(index)), 70e18);
        assertEq(index.totalNav(), 100e18);
    }

    function test_PausedUnderlyingDepositSkipped() public {
        address adapter = _deployAdapter(ERC4626_KIND, address(vaultA));
        _single(adapter);
        vaultA.setDepositsPaused(true);
        uint256 shares = _deposit(alice, 100e18);
        assertEq(shares, 100e18, "deposit still succeeds, fully backed");
        assertEq(baseToken.balanceOf(address(index)), 100e18);
    }

    function test_WithdrawalsDisabledQueueWaits() public {
        _zeroFees();
        (address adapterA, address adapterB) = _setupTwoAdapters();
        uint256 shares = _deposit(alice, 100e18);
        (, uint256 id) = _redeem(alice, shares, true);

        vaultA.setWithdrawalsDisabled(true);
        vaultB.setWithdrawalsDisabled(true);
        vm.prank(keeper);
        (uint256 raised,) = index.rebalance(10);
        assertEq(raised, 0, "illiquid underlying: nothing raised, nothing reverted");

        index.processRedemptions(10);
        assertEq(index.redemptionRequest(id).assetsPaid, 10e18, "only the buffer is paid");

        vaultA.setWithdrawalsDisabled(false);
        vm.prank(keeper);
        index.pullFromAdapter(adapterA, 45e18);
        vm.prank(keeper);
        index.pullFromAdapter(adapterB, 45e18); // still disabled: skipped, no revert
        index.processRedemptions(10);
        assertEq(index.redemptionRequest(id).assetsPaid, 55e18);
    }

    function test_ExitFeeBeyondSlippageRejectedByAdapter() public {
        address adapter = _deployAdapter(ERC4626_KIND, address(vaultA));
        _single(adapter);
        _deposit(alice, 100e18);
        // Vault starts charging 5% on redemption (> 1% adapter tolerance): previewRedeem drops,
        // so a new deposit's post-deposit value check fails and allocation is skipped.
        vaultA.setRedemptionFeeBps(500);
        uint256 before = vaultA.totalAssets();
        _deposit(bob, 100e18);
        assertEq(vaultA.totalAssets(), before, "allocation skipped on excessive exit cost");
        assertEq(IStrategyAdapter(adapter).totalAssets(), 90e18 * 9500 / 10_000, "valued net of exit fee");
    }
}
