// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC4626} from "./mocks/MockERC4626.sol";
import {MockAdapter} from "./mocks/MockAdapter.sol";
import {IndexFactory} from "../src/IndexFactory.sol";
import {IndexVault} from "../src/IndexVault.sol";
import {AdapterRegistry} from "../src/AdapterRegistry.sol";
import {IndexLens} from "../src/periphery/IndexLens.sol";
import {ERC4626Adapter} from "../src/adapters/ERC4626Adapter.sol";
import {MorphoVaultAdapter} from "../src/adapters/MorphoVaultAdapter.sol";
import {EulerVaultAdapter} from "../src/adapters/EulerVaultAdapter.sol";
import {RWAAdapter} from "../src/adapters/RWAAdapter.sol";

/// @notice Shared test fixture: deploys the full protocol stack and provides helper functions.
contract TestBase is Test {
    MockERC20 internal baseToken;
    MockERC4626 internal vaultA;
    MockERC4626 internal vaultB;

    AdapterRegistry internal registry;
    IndexFactory internal factory;
    IndexLens internal lens;
    IndexVault internal vaultImpl;

    address internal admin = makeAddr("admin");
    address internal curator = makeAddr("curator");
    address internal guardian = makeAddr("guardian");
    address internal keeper = makeAddr("keeper");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    IndexVault internal index;

    bytes32 internal constant ERC4626_KIND = keccak256("ERC4626");
    bytes32 internal constant MORPHO_KIND = keccak256("MORPHO");
    bytes32 internal constant EULER_KIND = keccak256("EULER");
    bytes32 internal constant RWA_KIND = keccak256("RWA");
    bytes32 internal constant MOCK_KIND = keccak256("MOCK");

    function setUp() public virtual {
        baseToken = new MockERC20("Base USD", "BASE", 18);
        vaultA = new MockERC4626(IERC20(address(baseToken)), "Vault A", "vA");
        vaultB = new MockERC4626(IERC20(address(baseToken)), "Vault B", "vB");
        _deployProtocol();
        index = _createIndex(_defaultConfig());
    }

    function _deployProtocol() internal {
        registry = new AdapterRegistry(admin);
        vaultImpl = new IndexVault();
        factory = new IndexFactory(admin, address(registry), address(vaultImpl));
        lens = new IndexLens();

        vm.startPrank(admin);
        registry.setImplementation(ERC4626_KIND, address(new ERC4626Adapter()), true);
        registry.setImplementation(MORPHO_KIND, address(new MorphoVaultAdapter()), true);
        registry.setImplementation(EULER_KIND, address(new EulerVaultAdapter()), true);
        registry.setImplementation(RWA_KIND, address(new RWAAdapter()), true);
        registry.setImplementation(MOCK_KIND, address(new MockAdapter()), true);
        registry.setTargetApproved(address(vaultA), true);
        registry.setTargetApproved(address(vaultB), true);
        vm.stopPrank();
    }

    function _approveTarget(address target) internal {
        vm.prank(admin);
        registry.setTargetApproved(target, true);
    }

    function _createIndex(IndexVault.IndexConfig memory cfg) internal returns (IndexVault) {
        vm.prank(admin);
        return IndexVault(factory.createIndex(cfg));
    }

    function _defaultConfig() internal view returns (IndexVault.IndexConfig memory) {
        return IndexVault.IndexConfig({
            name: "Vectra EDGE Index",
            symbol: "vEDGE",
            baseAsset: address(baseToken),
            admin: admin,
            curator: curator,
            guardian: guardian,
            keeper: keeper,
            feeRecipient: feeRecipient,
            complianceModule: address(0),
            managementFeeBps: 100, // 1%/yr
            performanceFeeBps: 1000, // 10% of gains
            liquidBufferBps: 1000, // 10%
            weightToleranceBps: 500, // 5%
            minDeposit: 1e15,
            minRedeem: 1e15,
            redemptionTtl: 7 days,
            maxQueueLength: 100,
            partialFillsEnabled: true
        });
    }

    function _deployAdapter(bytes32 kind, address target) internal returns (address) {
        vm.prank(curator);
        return index.deployAdapter(kind, target, 100); // 1% slippage
    }

    function _setWeights(address[] memory adapters, uint16[] memory weights) internal {
        vm.prank(curator);
        index.setAdapterWeights(adapters, weights);
    }

    function _setupTwoAdapters() internal returns (address adapterA, address adapterB) {
        adapterA = _deployAdapter(ERC4626_KIND, address(vaultA));
        adapterB = _deployAdapter(ERC4626_KIND, address(vaultB));
        address[] memory adapters = new address[](2);
        adapters[0] = adapterA;
        adapters[1] = adapterB;
        uint16[] memory weights = new uint16[](2);
        weights[0] = 5000;
        weights[1] = 5000;
        _setWeights(adapters, weights);
    }

    function _mintAndApprove(address account, uint256 amount) internal {
        baseToken.mint(account, amount);
        vm.prank(account);
        baseToken.approve(address(index), amount);
    }

    function _deposit(address account, uint256 amount) internal returns (uint256 shares) {
        _mintAndApprove(account, amount);
        vm.prank(account);
        shares = index.deposit(amount, 0, account);
    }

    function _redeem(address account, uint256 shares, bool allowQueue)
        internal
        returns (uint256 assetsOut, uint256 requestId)
    {
        vm.prank(account);
        (assetsOut, requestId) = index.redeem(shares, 0, allowQueue, account);
    }

    function _warpToExpiry(uint256 requestId) internal {
        vm.warp(index.redemptionRequest(requestId).expiresAt + 1);
    }

    function _zeroFees() internal {
        vm.prank(curator);
        index.setFeeConfig(0, 0);
    }
}
