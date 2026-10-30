// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import {Test} from "forge-std/Test.sol";
import {IndexFactory} from "../../src/IndexFactory.sol";
import {IndexVault} from "../../src/IndexVault.sol";
import {AdapterRegistry} from "../../src/AdapterRegistry.sol";
import {ERC4626Adapter} from "../../src/adapters/ERC4626Adapter.sol";
import {MorphoVaultAdapter} from "../../src/adapters/MorphoVaultAdapter.sol";
import {EulerVaultAdapter} from "../../src/adapters/EulerVaultAdapter.sol";
import {IStrategyAdapter} from "../../src/interfaces/IStrategyAdapter.sol";

/// @notice Full deposit → allocate → queue → rebalance → fill lifecycle against a real deployed vault.
/// @dev Opt-in and skipped by default. No addresses are hard-coded: the operator supplies a vault they
///      have verified on a block explorer.
///        FORK_RPC_URL=<rpc> FORK_VAULT=<erc4626 address> FORK_KIND=MORPHO|EULER|ERC4626 \
///        forge test --match-path test/fork/*
contract ERC4626ForkTest is Test {
    IndexVault internal index;
    IStrategyAdapter internal adapter;
    IERC20 internal asset;
    IERC4626 internal target;
    address internal admin = makeAddr("admin");
    address internal user = makeAddr("user");

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        address vaultAddr = vm.envOr("FORK_VAULT", address(0));
        if (bytes(rpc).length == 0 || vaultAddr == address(0)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        target = IERC4626(vaultAddr);
        asset = IERC20(target.asset());

        bytes32 kind = keccak256(bytes(vm.envOr("FORK_KIND", string("ERC4626"))));
        AdapterRegistry registry = new AdapterRegistry(admin);
        IndexFactory factory = new IndexFactory(admin, address(registry), address(new IndexVault()));
        vm.startPrank(admin);
        registry.setImplementation(keccak256("ERC4626"), address(new ERC4626Adapter()), true);
        registry.setImplementation(keccak256("MORPHO"), address(new MorphoVaultAdapter()), true);
        registry.setImplementation(keccak256("EULER"), address(new EulerVaultAdapter()), true);
        registry.setTargetApproved(vaultAddr, true);
        index = IndexVault(factory.createIndex(_config()));
        adapter = IStrategyAdapter(index.deployAdapter(kind, vaultAddr, 50));
        address[] memory a = new address[](1);
        a[0] = address(adapter);
        uint16[] memory w = new uint16[](1);
        w[0] = 10_000;
        index.setAdapterWeights(a, w);
        vm.stopPrank();
    }

    function _config() internal view returns (IndexVault.IndexConfig memory) {
        return IndexVault.IndexConfig({
            name: "Fork Index",
            symbol: "vFORK",
            baseAsset: address(asset),
            admin: admin,
            curator: admin,
            guardian: admin,
            keeper: admin,
            feeRecipient: admin,
            complianceModule: address(0),
            managementFeeBps: 0,
            performanceFeeBps: 0,
            liquidBufferBps: 1000,
            weightToleranceBps: 500,
            minDeposit: 1,
            minRedeem: 1,
            redemptionTtl: 7 days,
            maxQueueLength: 100,
            partialFillsEnabled: true
        });
    }

    function test_Fork_Lifecycle() public {
        uint256 amount = 10 ** IERC20Metadata(address(asset)).decimals() * 1_000;
        deal(address(asset), user, amount);
        vm.startPrank(user);
        asset.approve(address(index), amount);
        uint256 shares = index.deposit(amount, 0, user);
        vm.stopPrank();

        assertTrue(adapter.isHealthy(), "real vault healthy");
        assertApproxEqRel(index.totalNav(), amount, 0.001e18, "NAV within 10 bps of deposit");
        assertGt(adapter.totalAssets(), 0, "allocated to real vault");

        vm.prank(user);
        (, uint256 id) = index.redeem(shares, 0, true, user);
        assertGt(id, 0, "illiquid redemption queued");

        vm.prank(admin);
        index.rebalance(4);
        index.processRedemptions(10);
        assertApproxEqRel(asset.balanceOf(user), amount, 0.001e18, "round trip within 10 bps");
    }
}

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}
