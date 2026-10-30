// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IndexFactory} from "../src/IndexFactory.sol";
import {IndexVault} from "../src/IndexVault.sol";
import {AdapterRegistry} from "../src/AdapterRegistry.sol";
import {IndexLens} from "../src/periphery/IndexLens.sol";
import {ERC4626Adapter} from "../src/adapters/ERC4626Adapter.sol";
import {MorphoVaultAdapter} from "../src/adapters/MorphoVaultAdapter.sol";
import {EulerVaultAdapter} from "../src/adapters/EulerVaultAdapter.sol";
import {RWAAdapter} from "../src/adapters/RWAAdapter.sol";
import {PermissionlessCompliance} from "../src/compliance/PermissionlessCompliance.sol";

/// @notice Shared core deployment used by both the production and the local-demo scripts.
abstract contract CoreDeployer is Script {
    struct Core {
        address registry;
        address vaultImplementation;
        address factory;
        address lens;
        address permissionless;
        address erc4626Adapter;
        address morphoAdapter;
        address eulerAdapter;
        address rwaAdapter;
        uint256 startBlock;
    }

    /// @dev Must be called inside a broadcast. `deployer` temporarily administers the registry so it
    ///      can approve implementations, then hands DEFAULT_ADMIN to `admin` and renounces.
    function _deployCore(address deployer, address admin) internal returns (Core memory c) {
        c.startBlock = block.number;
        AdapterRegistry registry = new AdapterRegistry(deployer);
        c.registry = address(registry);
        c.vaultImplementation = address(new IndexVault());
        c.factory = address(new IndexFactory(admin, c.registry, c.vaultImplementation));
        c.lens = address(new IndexLens());
        c.permissionless = address(new PermissionlessCompliance());

        c.erc4626Adapter = address(new ERC4626Adapter());
        c.morphoAdapter = address(new MorphoVaultAdapter());
        c.eulerAdapter = address(new EulerVaultAdapter());
        c.rwaAdapter = address(new RWAAdapter());
        registry.setImplementation(keccak256("ERC4626"), c.erc4626Adapter, true);
        registry.setImplementation(keccak256("MORPHO"), c.morphoAdapter, true);
        registry.setImplementation(keccak256("EULER"), c.eulerAdapter, true);
        registry.setImplementation(keccak256("RWA"), c.rwaAdapter, true);

        if (admin != deployer) {
            registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), admin);
            registry.renounceRole(registry.DEFAULT_ADMIN_ROLE(), deployer);
        }
    }

    function _writeCore(Core memory c, string memory key) internal returns (string memory json) {
        vm.serializeAddress(key, "registry", c.registry);
        vm.serializeAddress(key, "vaultImplementation", c.vaultImplementation);
        vm.serializeAddress(key, "factory", c.factory);
        vm.serializeAddress(key, "lens", c.lens);
        vm.serializeAddress(key, "permissionlessCompliance", c.permissionless);
        vm.serializeAddress(key, "erc4626AdapterImpl", c.erc4626Adapter);
        vm.serializeAddress(key, "morphoAdapterImpl", c.morphoAdapter);
        vm.serializeAddress(key, "eulerAdapterImpl", c.eulerAdapter);
        vm.serializeAddress(key, "rwaAdapterImpl", c.rwaAdapter);
        vm.serializeUint(key, "chainId", block.chainid);
        json = vm.serializeUint(key, "startBlock", c.startBlock);
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    }
}

/// @notice Production deployment of the core protocol (no indexes).
/// @dev Usage:
///   VECTRA_ADMIN=<multisig or timelock> forge script script/DeployCore.s.sol \
///     --rpc-url $RPC_URL --account <keystore> --sender <deployer> --broadcast --verify
contract DeployCore is CoreDeployer {
    function run() external returns (Core memory c) {
        address admin = vm.envAddress("VECTRA_ADMIN");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        c = _deployCore(deployer, admin);
        vm.stopBroadcast();

        vm.writeJson(_writeCore(c, "core"), _deploymentPath());
        console2.log("Factory", c.factory);
        console2.log("Lens", c.lens);
    }
}
