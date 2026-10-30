// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "../TestBase.sol";
import {IndexVault} from "../../src/IndexVault.sol";
import {IndexFactory} from "../../src/IndexFactory.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {Roles} from "../../src/AccessRoles.sol";
import {Initializable} from "openzeppelin-contracts/contracts/proxy/utils/Initializable.sol";

/// @notice Index creation, access control, deposits, NAV and instant redemptions.
contract IndexCoreTest is TestBase {
    function test_InitialState() public view {
        assertEq(index.name(), "Vectra EDGE Index");
        assertEq(index.symbol(), "vEDGE");
        assertEq(index.decimals(), 18);
        assertEq(address(index.baseAsset()), address(baseToken));
        assertEq(index.factory(), address(factory));
        assertEq(index.curator(), curator);
        assertEq(index.totalNav(), 0);
        assertEq(lens.getIndex(index).pricePerShare, 0);
        assertEq(index.availableLiquidity(), 0);
        assertEq(index.liquidBufferBps(), 1000);
        assertEq(index.managementFeeBps(), 100);
        assertEq(index.performanceFeeBps(), 1000);
        assertEq(index.nextRequestId(), 1);
        assertTrue(index.hasRole(Roles.CURATOR, curator));
        assertTrue(index.hasRole(Roles.PAUSER, guardian));
        assertTrue(index.hasRole(Roles.KEEPER, keeper));
        assertTrue(index.hasRole(Roles.DEFAULT_ADMIN, admin));
        assertFalse(index.hasRole(Roles.DEFAULT_ADMIN, address(factory)), "factory holds no power");
    }

    function test_ImplementationCannotBeInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vaultImpl.initialize(_defaultConfig(), address(registry));
    }

    function test_CloneCannotBeReinitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        index.initialize(_defaultConfig(), address(registry));
    }

    function test_OnlyCreatorCanCreateIndex() public {
        vm.prank(alice);
        vm.expectRevert();
        factory.createIndex(_defaultConfig());

        bytes32 creatorRole = factory.CREATOR_ROLE();
        vm.prank(admin);
        factory.grantRole(creatorRole, alice);
        vm.prank(alice);
        address vault = factory.createIndex(_defaultConfig());
        assertTrue(factory.isIndex(vault));
        assertEq(factory.indexesLength(), 2);
    }

    function test_CreationPause() public {
        vm.prank(admin);
        factory.setCreationPaused(true);
        vm.prank(admin);
        vm.expectRevert(IndexFactory.CreationPaused.selector);
        factory.createIndex(_defaultConfig());
    }

    function test_InvalidConfigReverts() public {
        IndexVault.IndexConfig memory cfg = _defaultConfig();
        cfg.liquidBufferBps = 9_001;
        vm.prank(admin);
        vm.expectRevert(IndexVault.InvalidParameter.selector);
        factory.createIndex(cfg);

        cfg = _defaultConfig();
        cfg.redemptionTtl = 10 minutes;
        vm.prank(admin);
        vm.expectRevert(IndexVault.InvalidParameter.selector);
        factory.createIndex(cfg);

        cfg = _defaultConfig();
        cfg.curator = address(0);
        vm.prank(admin);
        vm.expectRevert();
        factory.createIndex(cfg);
    }

    function test_DepositMintsShares() public {
        uint256 shares = _deposit(alice, 100e18);
        // 18-decimal base: virtualShares = 1, so the first deposit mints 1:1.
        assertEq(shares, 100e18);
        assertEq(index.totalNav(), 100e18);
        assertEq(index.availableLiquidity(), 100e18);
        assertEq(index.balanceOf(alice), shares);
        assertEq(index.totalSupply(), shares);
    }

    function test_SixDecimalBaseMints18DecimalShares() public {
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        IndexVault.IndexConfig memory cfg = _defaultConfig();
        cfg.baseAsset = address(usdc);
        cfg.minDeposit = 1e6;
        index = _createIndex(cfg);
        assertEq(index.virtualShares(), 1e12);

        usdc.mint(alice, 100e6);
        vm.startPrank(alice);
        usdc.approve(address(index), 100e6);
        uint256 shares = index.deposit(100e6, 0, alice);
        vm.stopPrank();
        assertEq(shares, 100e18, "6-dec deposit scaled to 18-dec shares");
        assertEq(lens.getIndex(index).pricePerShare, 1e6, "pps is in base units per 1e18 shares");
    }

    function test_DepositBelowMinimumReverts() public {
        _mintAndApprove(alice, 1e14);
        vm.prank(alice);
        vm.expectRevert(IndexVault.BelowMinimum.selector);
        index.deposit(1e14, 0, alice);
    }

    function test_DepositZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(IndexVault.ZeroAmount.selector);
        index.deposit(0, 0, alice);
    }

    function test_DepositToZeroReceiverReverts() public {
        _mintAndApprove(alice, 1e18);
        vm.prank(alice);
        vm.expectRevert();
        index.deposit(1e18, 0, address(0));
    }

    function test_DepositSlippageFloor() public {
        _mintAndApprove(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(IndexVault.SlippageExceeded.selector);
        index.deposit(100e18, 100e18 + 1, alice);
    }

    function test_DepositAllocatesToAdaptersAndKeepsBuffer() public {
        (address adapterA, address adapterB) = _setupTwoAdapters();
        _deposit(alice, 100e18);

        assertEq(index.totalNav(), 100e18, "nav == deposit");
        assertEq(baseToken.balanceOf(address(index)), 10e18, "10% buffer stays liquid");
        assertEq(vaultA.totalAssets(), 45e18, "45% in A");
        assertEq(vaultB.totalAssets(), 45e18, "45% in B");
        assertGt(adapterA.code.length, 0);
        assertGt(adapterB.code.length, 0);
    }

    function test_YieldAccruesToHolders() public {
        _zeroFees();
        _setupTwoAdapters();
        uint256 aliceShares = _deposit(alice, 100e18);

        // Underlying vault earns 10% on its 45e18.
        baseToken.mint(address(this), 4.5e18);
        baseToken.approve(address(vaultA), 4.5e18);
        vaultA.donate(4.5e18);

        assertApproxEqAbs(index.totalNav(), 104.5e18, 2);
        uint256 bobShares = _deposit(bob, 104.5e18);
        assertApproxEqRel(bobShares, aliceShares, 1e12, "bob pays post-yield price");
    }

    function test_UnderlyingLossReducesNav() public {
        _zeroFees();
        _setupTwoAdapters();
        _deposit(alice, 100e18);
        vaultA.setLossBps(1000); // 10% loss on 45e18
        assertApproxEqAbs(index.totalNav(), 95.5e18, 2);
    }

    function test_FirstDepositorDonationAttackIsUnprofitable() public {
        _zeroFees();
        // Attacker deposits the minimum then donates a large amount to inflate price per share.
        uint256 attackerShares = _deposit(carol, 1e15);
        baseToken.mint(address(index), 1_000e18);

        uint256 victimShares = _deposit(alice, 100e18);
        assertGt(victimShares, 0, "victim still receives shares");

        (uint256 victimValue,) = lens.previewRedeem(index, victimShares);
        assertApproxEqRel(victimValue, 100e18, 0.01e18, "victim loses < 1%");
        (uint256 attackerValue,) = lens.previewRedeem(index, attackerShares);
        assertLt(attackerValue, 1_000e18 + 1e15, "attacker cannot recover donation");
    }

    function test_InstantRedemption() public {
        uint256 shares = _deposit(alice, 100e18);
        (uint256 assetsOut, uint256 requestId) = _redeem(alice, shares / 2, false);
        assertEq(assetsOut, 50e18, "instant redeem at NAV");
        assertEq(requestId, 0);
        assertEq(index.balanceOf(alice), shares / 2);
        assertEq(baseToken.balanceOf(alice), 50e18);
    }

    function test_RedeemToOtherReceiver() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        index.redeem(shares, 0, false, bob);
        assertEq(baseToken.balanceOf(bob), 100e18);
    }

    function test_RedeemZeroReverts() public {
        _deposit(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(IndexVault.BelowMinimum.selector);
        index.redeem(0, 0, false, alice);
    }

    function test_RedeemInsufficientShares() public {
        _deposit(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(IndexVault.InsufficientShares.selector);
        index.redeem(200e18, 0, false, alice);
    }

    function test_RedeemSlippageFloor() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(IndexVault.SlippageExceeded.selector);
        index.redeem(shares, 100e18 + 1, false, alice);
    }

    function test_RedeemNoQueueRevertsWhenIlliquid() public {
        _setupTwoAdapters();
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IndexVault.InsufficientLiquidity.selector, 100e18, 10e18));
        index.redeem(shares, 0, false, alice);
    }

    function test_PauseDeposits() public {
        vm.prank(guardian);
        index.setDepositsPaused(true);
        _mintAndApprove(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(IndexVault.DepositsPaused.selector);
        index.deposit(100e18, 0, alice);
    }

    function test_OnlyPauserCanPause() public {
        vm.prank(curator);
        vm.expectRevert();
        index.setDepositsPaused(true);
    }

    function test_EmergencyShutdownIsIrreversibleAndExitsStayOpen() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(guardian);
        index.emergencyShutdown();

        assertTrue(index.shutdown());
        assertTrue(index.depositsPaused());
        vm.prank(guardian);
        vm.expectRevert(IndexVault.InvalidParameter.selector);
        index.setDepositsPaused(false);

        _mintAndApprove(bob, 100e18);
        vm.prank(bob);
        vm.expectRevert(IndexVault.DepositsPaused.selector);
        index.deposit(100e18, 0, bob);

        (uint256 out,) = _redeem(alice, shares, false);
        assertGt(out, 0, "exit still possible");
    }

    function test_ProtectedConfigRequiresRoles() public {
        address[] memory none = new address[](0);
        uint16[] memory noWeights = new uint16[](0);

        vm.startPrank(alice);
        vm.expectRevert();
        index.setAdapterWeights(none, noWeights);
        vm.expectRevert();
        index.setLiquidityParams(0, 0);
        vm.expectRevert();
        index.setLimits(1, 1, 1 days, 1, false);
        vm.expectRevert();
        index.setFeeConfig(0, 0);
        vm.expectRevert();
        index.setFeeRecipient(alice);
        vm.expectRevert();
        index.setCompliance(address(0)); // admin-only
        vm.expectRevert();
        index.setCurator(alice);
        vm.expectRevert();
        index.deployAdapter(ERC4626_KIND, address(vaultA), 100);
        vm.expectRevert();
        index.rebalance(1);
        vm.expectRevert();
        index.emergencyShutdown();
        vm.stopPrank();
    }

    function test_CuratorRotation() public {
        vm.prank(admin);
        index.setCurator(bob);
        assertEq(index.curator(), bob);
        assertTrue(index.hasRole(Roles.CURATOR, bob));
        assertFalse(index.hasRole(Roles.CURATOR, curator));
    }

    function test_WeightsMustSumToTenThousand() public {
        address adapterA = _deployAdapter(ERC4626_KIND, address(vaultA));
        address adapterB = _deployAdapter(ERC4626_KIND, address(vaultB));
        address[] memory adapters = new address[](2);
        adapters[0] = adapterA;
        adapters[1] = adapterB;
        uint16[] memory weights = new uint16[](2);
        weights[0] = 4000;
        weights[1] = 5000;
        vm.prank(curator);
        vm.expectRevert(IndexVault.InvalidWeights.selector);
        index.setAdapterWeights(adapters, weights);
    }

    function test_DuplicateAdapterInWeightsReverts() public {
        address adapterA = _deployAdapter(ERC4626_KIND, address(vaultA));
        address[] memory adapters = new address[](2);
        adapters[0] = adapterA;
        adapters[1] = adapterA;
        uint16[] memory weights = new uint16[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        vm.prank(curator);
        vm.expectRevert(IndexVault.InvalidWeights.selector);
        index.setAdapterWeights(adapters, weights);
    }

    function test_OmittedAdapterIsDisabledButStillValued() public {
        (address adapterA, address adapterB) = _setupTwoAdapters();
        _deposit(alice, 100e18);

        address[] memory adapters = new address[](1);
        adapters[0] = adapterA;
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        _setWeights(adapters, weights);

        (IndexVault.AdapterConfig memory b) = index.adapterAt(1);
        assertEq(b.adapter, adapterB);
        assertFalse(b.enabled);
        assertEq(b.targetBps, 0);
        assertEq(index.totalNav(), 100e18, "disabled position still counted");
    }

    function test_EmptyWeightsAllowedForFullyLiquidIndex() public {
        _setWeights(new address[](0), new uint16[](0));
        _deposit(alice, 100e18);
        assertEq(baseToken.balanceOf(address(index)), 100e18);
    }

    function test_ForeignAdapterRejected() public {
        // Adapter created by a different index cannot be attached here.
        IndexVault other = _createIndex(_defaultConfig());
        vm.prank(curator);
        address foreign = other.deployAdapter(ERC4626_KIND, address(vaultA), 100);

        address[] memory adapters = new address[](1);
        adapters[0] = foreign;
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        vm.prank(curator);
        vm.expectRevert(IndexVault.AdapterMismatch.selector);
        index.setAdapterWeights(adapters, weights);
    }

    function test_UnregisteredAdapterRejected() public {
        address[] memory adapters = new address[](1);
        adapters[0] = address(vaultA);
        uint16[] memory weights = new uint16[](1);
        weights[0] = 10_000;
        vm.prank(curator);
        vm.expectRevert(IndexVault.AdapterNotApproved.selector);
        index.setAdapterWeights(adapters, weights);
    }

    function test_RemoveAdapterRequiresEmptyPosition() public {
        (address adapterA,) = _setupTwoAdapters();
        _deposit(alice, 100e18);
        vm.prank(curator);
        vm.expectRevert(IndexVault.InvalidAdapterState.selector);
        index.removeAdapter(adapterA);

        vm.prank(keeper);
        index.pullFromAdapter(adapterA, 45e18);
        vm.prank(curator);
        index.removeAdapter(adapterA);
        assertEq(index.adaptersLength(), 1);
    }

    function test_SharesTransferPermissionless() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        index.transfer(bob, shares / 2);
        assertEq(index.balanceOf(bob), shares / 2);
    }

    function test_DirectTransferToVaultReverts() public {
        uint256 shares = _deposit(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(IndexVault.TransferToVault.selector);
        index.transfer(address(index), shares);
    }

    function test_RevertOnFeeOnTransferBase() public {
        baseToken.setTransferFeeBps(100);
        _mintAndApprove(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(IndexVault.NonStandardTransfer.selector);
        index.deposit(100e18, 0, alice);
    }

    function test_ConfigVersionIncrements() public {
        uint64 v = index.configVersion();
        vm.prank(curator);
        index.setLiquidityParams(2000, 500);
        assertEq(index.configVersion(), v + 1);
    }

    function testFuzz_DepositRedeemRoundTripNeverProfits(uint256 amount, uint256 donation) public {
        _zeroFees();
        amount = bound(amount, 1e15, 1e30);
        donation = bound(donation, 0, 1e30);
        _deposit(carol, 1e18);
        baseToken.mint(address(index), donation);

        // The virtual-share offset (OpenZeppelin ERC-4626 design) lets a depositor capture at most
        // the value of `virtualShares` at the current price; anything beyond that is a bug.
        uint256 maxLeak = index.virtualShares() * index.totalNav() / index.totalSupply() + 1;

        uint256 shares = _deposit(alice, amount);
        vm.assume(shares >= index.minRedeem());
        (uint256 out,) = _redeem(alice, shares, false);
        assertLe(out, amount + maxLeak, "round trip extracts more than the virtual-share bound");
    }

    function testFuzz_DepositRedeemRoundTripAtParNeverProfits(uint256 seed, uint256 amount) public {
        _zeroFees();
        seed = bound(seed, 1e15, 1e30);
        amount = bound(amount, 1e15, 1e30);
        _deposit(carol, seed);

        uint256 shares = _deposit(alice, amount);
        (uint256 out,) = _redeem(alice, shares, false);
        assertLe(out, amount, "round trip at par cannot extract value");
    }
}
