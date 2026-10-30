// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {CoreDeployer} from "./DeployCore.s.sol";
import {IndexFactory} from "../src/IndexFactory.sol";
import {IndexVault} from "../src/IndexVault.sol";
import {AllowlistCompliance} from "../src/compliance/AllowlistCompliance.sol";
import {AdapterRegistry} from "../src/AdapterRegistry.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockERC4626} from "../test/mocks/MockERC4626.sol";
import {MockMetaMorpho} from "../test/mocks/MockMetaMorpho.sol";

/// @notice LOCAL DEVELOPMENT ONLY (anvil, chain 31337). Deploys the core protocol plus MOCK tokens
///         and MOCK ERC-4626 vaults, creates three demo indexes and seeds them. Every demo asset is a
///         mock; nothing here represents a real protocol, curator or token.
///   anvil &
///   forge script script/LocalDemo.s.sol --rpc-url http://127.0.0.1:8545 \
///     --private-key <anvil key 0> --broadcast
contract LocalDemo is CoreDeployer {
    // Anvil's well-known default account #1, used as the demo keeper bot.
    address internal constant ANVIL_ACCOUNT_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant ANVIL_ACCOUNT_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    MockERC20 internal usdc;
    AdapterRegistry internal registry;
    address internal deployer;
    address internal keeper;

    function run() external {
        require(block.chainid == 31337, "LocalDemo is for anvil only");
        keeper = vm.envOr("DEMO_KEEPER", ANVIL_ACCOUNT_1);

        vm.startBroadcast();
        (, deployer,) = vm.readCallers();
        Core memory c = _deployCore(deployer, deployer);
        registry = AdapterRegistry(c.registry);
        usdc = new MockERC20("Mock USD Coin (DEV)", "mUSDC", 6);
        usdc.mint(deployer, 10_000_000e6);
        usdc.mint(ANVIL_ACCOUNT_2, 1_000_000e6);

        address lending = _lendingIndex(IndexFactory(c.factory));
        (address rwa, address compliance) = _rwaIndex(IndexFactory(c.factory));
        address liquid = _liquidIndex(IndexFactory(c.factory));
        vm.stopBroadcast();

        string memory json = _writeCore(c, "demo");
        vm.serializeAddress("demo", "baseAsset", address(usdc));
        vm.serializeAddress("demo", "rwaCompliance", compliance);
        vm.serializeBool("demo", "mock", true);
        address[] memory indexes = new address[](3);
        indexes[0] = lending;
        indexes[1] = rwa;
        indexes[2] = liquid;
        json = vm.serializeAddress("demo", "indexes", indexes);
        vm.writeJson(json, _deploymentPath());
    }

    function _config(string memory name, string memory symbol, uint16 bufferBps)
        internal
        view
        returns (IndexVault.IndexConfig memory)
    {
        return IndexVault.IndexConfig({
            name: name,
            symbol: symbol,
            baseAsset: address(usdc),
            admin: deployer,
            curator: deployer,
            guardian: deployer,
            keeper: keeper,
            feeRecipient: deployer,
            complianceModule: address(0),
            managementFeeBps: 50,
            performanceFeeBps: 1000,
            liquidBufferBps: bufferBps,
            weightToleranceBps: 300,
            minDeposit: 1e6,
            minRedeem: 1e15,
            redemptionTtl: 7 days,
            maxQueueLength: 500,
            partialFillsEnabled: true
        });
    }

    /// @dev Mock vaults are approved as targets here only because they are local mocks; on real
    ///      networks every target is vetted and approved by registry governance.
    function _vault(string memory name, string memory symbol) internal returns (address v) {
        v = address(new MockERC4626(IERC20(address(usdc)), name, symbol));
        registry.setTargetApproved(v, true);
    }

    function _morphoVault() internal returns (address v) {
        v = address(new MockMetaMorpho(IERC20(address(usdc))));
        registry.setTargetApproved(v, true);
    }

    function _lendingIndex(IndexFactory factory) internal returns (address) {
        IndexVault v = IndexVault(factory.createIndex(_config("Demo Lending Blend", "vDLB", 1000)));
        address[] memory a = new address[](3);
        a[0] = v.deployAdapter(keccak256("MORPHO"), _morphoVault(), 50);
        a[1] = v.deployAdapter(keccak256("EULER"), _vault("Mock Euler USDC (DEV)", "meUSDC"), 50);
        a[2] = v.deployAdapter(keccak256("ERC4626"), _vault("Mock 4626 USDC (DEV)", "m4626"), 50);
        uint16[] memory w = new uint16[](3);
        w[0] = 4000;
        w[1] = 3500;
        w[2] = 2500;
        v.setAdapterWeights(a, w);
        _seed(v, 250_000e6);
        return address(v);
    }

    function _rwaIndex(IndexFactory factory) internal returns (address, address) {
        AllowlistCompliance compliance = new AllowlistCompliance(keccak256("DEMO_RWA"), deployer, address(0));
        compliance.setEligibility(deployer, true, 0);
        compliance.setEligibility(ANVIL_ACCOUNT_2, true, 0);

        IndexVault.IndexConfig memory cfg = _config("Demo Tokenized Treasury (Restricted)", "vDRWA", 500);
        cfg.complianceModule = address(compliance);
        IndexVault v = IndexVault(factory.createIndex(cfg));
        address[] memory a = new address[](1);
        a[0] = v.deployAdapter(keccak256("RWA"), _vault("Mock T-Bill Vault (DEV)", "mTBILL"), 25);
        uint16[] memory w = new uint16[](1);
        w[0] = 10_000;
        v.setAdapterWeights(a, w);
        _seed(v, 100_000e6);
        return (address(v), address(compliance));
    }

    function _liquidIndex(IndexFactory factory) internal returns (address) {
        IndexVault v = IndexVault(factory.createIndex(_config("Demo Liquid Yield", "vDLY", 2000)));
        address[] memory a = new address[](1);
        a[0] = v.deployAdapter(keccak256("ERC4626"), _vault("Mock Savings Vault (DEV)", "mSAVE"), 50);
        uint16[] memory w = new uint16[](1);
        w[0] = 10_000;
        v.setAdapterWeights(a, w);
        _seed(v, 50_000e6);
        return address(v);
    }

    function _seed(IndexVault v, uint256 amount) internal {
        usdc.approve(address(v), amount);
        v.deposit(amount, 0, deployer);
    }
}
