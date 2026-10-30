// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {IndexVault} from "../../src/IndexVault.sol";
import {IndexFactory} from "../../src/IndexFactory.sol";
import {AdapterRegistry} from "../../src/AdapterRegistry.sol";
import {IndexLens} from "../../src/periphery/IndexLens.sol";
import {IIndexVault} from "../../src/interfaces/IIndexVault.sol";
import {IStrategyAdapter} from "../../src/interfaces/IStrategyAdapter.sol";

/// @notice Read paths used by the app, API and keepers, plus factory/registry admin guards.
contract LensAndFactoryTest is TestBase {
    function test_GetIndexMatchesVault() public {
        _setupTwoAdapters();
        _deposit(alice, 100e18);
        IndexLens.IndexView memory v = lens.getIndex(index);

        assertEq(v.vault, address(index));
        assertEq(v.symbol, "vEDGE");
        assertEq(v.nav, index.totalNav());
        assertTrue(v.navHealthy);
        assertEq(v.pricePerShare, index.totalNav() * 1e18 / index.totalSupply());
        assertEq(v.availableLiquidity, index.availableLiquidity());
        assertEq(v.compliancePolicy, "permissionless");
        assertEq(v.adapters.length, 2);
        assertEq(v.adapters[0].kind, ERC4626_KIND);
        assertEq(v.adapters[0].target, address(vaultA));
        assertEq(v.adapters[0].totalAssets, 45e18);
        assertEq(v.adapters[0].targetAssets, 45e18);
        assertTrue(v.adapters[0].healthy);
    }

    function test_GetIndexesBatch() public {
        IndexVault second = _createIndex(_defaultConfig());
        IndexVault[] memory list = new IndexVault[](2);
        list[0] = index;
        list[1] = second;
        IndexLens.IndexView[] memory views = lens.getIndexes(list);
        assertEq(views.length, 2);
        assertEq(views[1].vault, address(second));
    }

    function test_GetUser() public {
        _zeroFees();
        _deposit(alice, 100e18);
        baseToken.mint(alice, 7e18);
        vm.prank(alice);
        baseToken.approve(address(index), 3e18);

        IndexLens.UserView memory u = lens.getUser(index, alice);
        assertEq(u.shares, 100e18);
        assertEq(u.value, 100e18);
        assertEq(u.baseBalance, 7e18);
        assertEq(u.baseAllowance, 3e18);
    }

    function test_GetRequestsAndPreviewRequest() public {
        _zeroFees();
        _setupTwoAdapters();
        uint256 shares = _deposit(alice, 100e18);
        _redeem(alice, shares / 2, true);
        _redeem(alice, shares / 2, true);

        (uint256[] memory ids, IIndexVault.RedemptionRequest[] memory reqs) = lens.getRequests(index, 1, 100);
        assertEq(ids.length, 2, "clamped to nextRequestId");
        assertEq(ids[1], 2);
        assertEq(reqs[0].owner, alice);
        assertEq(lens.previewRequest(index, 1), 50e18);
    }

    function test_PreviewRedeemSignalsQueueWhenIlliquid() public {
        _zeroFees();
        _setupTwoAdapters();
        uint256 shares = _deposit(alice, 100e18);
        (uint256 assets, uint256 available) = lens.previewRedeem(index, shares);
        assertEq(assets, 100e18);
        assertEq(available, 10e18);
    }

    function test_FactoryEnumeration() public view {
        assertEq(factory.indexesLength(), 1);
        assertEq(factory.indexAt(0), address(index));
        assertEq(factory.allIndexes()[0], address(index));
        assertEq(factory.vaultImplementation(), address(vaultImpl));
    }

    function test_FactoryConstructorValidation() public {
        vm.expectRevert(IndexFactory.ZeroAddress.selector);
        new IndexFactory(address(0), address(registry), address(vaultImpl));
        vm.expectRevert(IndexFactory.NotAContract.selector);
        new IndexFactory(admin, makeAddr("eoa"), address(vaultImpl));
    }

    function test_OnlyPauserPausesCreation() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.setCreationPaused(true);
    }

    function test_RegistryGuards() public {
        vm.expectRevert(AdapterRegistry.ZeroAddress.selector);
        new AdapterRegistry(address(0));

        vm.startPrank(admin);
        vm.expectRevert(AdapterRegistry.ZeroAddress.selector);
        registry.setImplementation(ERC4626_KIND, address(0), true);
        vm.expectRevert(AdapterRegistry.NotAContract.selector);
        registry.setImplementation(ERC4626_KIND, makeAddr("eoa"), true);
        vm.expectRevert(AdapterRegistry.NotAContract.selector);
        registry.setTargetApproved(makeAddr("eoa"), true);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert();
        registry.setImplementation(ERC4626_KIND, address(vaultA), true);
    }

    function test_AdapterKindsReportCorrectly() public {
        assertEq(IStrategyAdapter(_deployAdapter(ERC4626_KIND, address(vaultA))).kind(), ERC4626_KIND);
        assertEq(IStrategyAdapter(_deployAdapter(EULER_KIND, address(vaultA))).kind(), EULER_KIND);
        assertEq(IStrategyAdapter(_deployAdapter(RWA_KIND, address(vaultA))).kind(), RWA_KIND);
        assertEq(IStrategyAdapter(_deployAdapter(MORPHO_KIND, address(vaultA))).kind(), MORPHO_KIND);
        assertEq(registry.adapterKind(_deployAdapter(RWA_KIND, address(vaultB))), RWA_KIND);
    }
}
