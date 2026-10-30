// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IndexFactory} from "../src/IndexFactory.sol";
import {IndexVault} from "../src/IndexVault.sol";

/// @notice Creates an index from a JSON config and, when the broadcaster is also the curator,
///         deploys its adapters and sets weights.
/// @dev Underlying vault addresses must come from the config file and be verified by the operator
///      on the target chain (asset, ERC-4626 behaviour, liquidity, permissions) and approved by
///      registry governance via `AdapterRegistry.setTargetApproved`. Nothing is assumed.
///   INDEX_CONFIG=script/config/example-index.json forge script script/CreateIndex.s.sol \
///     --rpc-url $RPC_URL --account <keystore> --sender <creator> --broadcast
contract CreateIndex is Script {
    using stdJson for string;

    function run() external returns (address vault) {
        string memory json = vm.readFile(vm.envString("INDEX_CONFIG"));
        string memory deployment =
            vm.readFile(string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json"));
        IndexFactory factory = IndexFactory(deployment.readAddress(".factory"));

        IndexVault.IndexConfig memory cfg = _readConfig(json);
        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        vault = factory.createIndex(cfg);
        if (sender == cfg.curator) _configureAdapters(IndexVault(vault), json);
        vm.stopBroadcast();
        console2.log("Index", vault);
    }

    function _readConfig(string memory json) internal pure returns (IndexVault.IndexConfig memory cfg) {
        cfg.name = json.readString(".name");
        cfg.symbol = json.readString(".symbol");
        cfg.baseAsset = json.readAddress(".baseAsset");
        cfg.admin = json.readAddress(".admin");
        cfg.curator = json.readAddress(".curator");
        cfg.guardian = json.readAddress(".guardian");
        cfg.keeper = json.readAddress(".keeper");
        cfg.feeRecipient = json.readAddress(".feeRecipient");
        cfg.complianceModule = json.readAddress(".complianceModule");
        cfg.managementFeeBps = uint16(json.readUint(".managementFeeBps"));
        cfg.performanceFeeBps = uint16(json.readUint(".performanceFeeBps"));
        cfg.liquidBufferBps = uint16(json.readUint(".liquidBufferBps"));
        cfg.weightToleranceBps = uint16(json.readUint(".weightToleranceBps"));
        cfg.minDeposit = json.readUint(".minDeposit");
        cfg.minRedeem = json.readUint(".minRedeem");
        cfg.redemptionTtl = uint64(json.readUint(".redemptionTtl"));
        cfg.maxQueueLength = uint32(json.readUint(".maxQueueLength"));
        cfg.partialFillsEnabled = json.readBool(".partialFillsEnabled");
    }

    function _configureAdapters(IndexVault vault, string memory json) internal {
        string[] memory kinds = json.readStringArray(".adapters.kinds");
        address[] memory targets = json.readAddressArray(".adapters.targets");
        uint256[] memory weights = json.readUintArray(".adapters.weightsBps");
        uint256[] memory slippage = json.readUintArray(".adapters.slippageBps");
        require(kinds.length == targets.length && targets.length == weights.length, "adapter config length");

        address[] memory adapters = new address[](kinds.length);
        uint16[] memory w = new uint16[](kinds.length);
        for (uint256 i = 0; i < kinds.length; i++) {
            adapters[i] = vault.deployAdapter(keccak256(bytes(kinds[i])), targets[i], uint16(slippage[i]));
            w[i] = uint16(weights[i]);
        }
        if (adapters.length != 0) vault.setAdapterWeights(adapters, w);
    }
}
