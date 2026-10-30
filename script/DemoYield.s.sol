// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CoreDeployer} from "./DeployCore.s.sol";
import {IndexVault} from "../src/IndexVault.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @notice LOCAL DEVELOPMENT ONLY: simulates yield by minting mock USDC into every mock vault held
///         by the demo indexes. Lets the analytics pipeline show NAV movement on anvil.
///   forge script script/DemoYield.s.sol --rpc-url http://127.0.0.1:8545 --private-key <key0> --broadcast
contract DemoYield is CoreDeployer {
    function run() external {
        require(block.chainid == 31337, "anvil only");
        string memory json = vm.readFile(_deploymentPath());
        address[] memory indexes = vm.parseJsonAddressArray(json, ".indexes");
        MockERC20 usdc = MockERC20(vm.parseJsonAddress(json, ".baseAsset"));
        uint256 bps = vm.envOr("DEMO_YIELD_BPS", uint256(5)); // 0.05% per tick
        vm.startBroadcast();
        for (uint256 i = 0; i < indexes.length; i++) {
            IndexVault v = IndexVault(indexes[i]);
            for (uint256 j = 0; j < v.adaptersLength(); j++) {
                address target = MockERC4626Like(v.adapterAt(j).adapter).target();
                uint256 assets = usdc.balanceOf(target);
                usdc.mint(target, assets * bps / 10_000);
            }
        }
        vm.stopBroadcast();
    }
}

interface MockERC4626Like {
    function target() external view returns (address);
}
