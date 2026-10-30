// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {CoreDeployer} from "./DeployCore.s.sol";
import {IndexFactory} from "../src/IndexFactory.sol";
import {IndexVault} from "../src/IndexVault.sol";
import {AdapterRegistry} from "../src/AdapterRegistry.sol";
import {AllowlistCompliance} from "../src/compliance/AllowlistCompliance.sol";
import {TestnetToken} from "./testnet/TestnetToken.sol";
import {TestnetYieldVault} from "./testnet/TestnetYieldVault.sol";

/// @notice PUBLIC TESTNET deployment: core protocol + faucet test USDC + testnet strategy vaults that
///         accrue yield at fixed rates + curator- and strategy-specific indexes, seeded with deposits.
/// @dev The strategy vaults EMULATE curated strategies for demonstration; they are not deployed by, nor
///      affiliated with, any curator named in their labels. Refuses to run on production chains.
///   forge script script/TestnetDeploy.s.sol --rpc-url $SEPOLIA_RPC --private-key $PK --broadcast --slow
contract TestnetDeploy is CoreDeployer {
    struct Strategy {
        string name;
        string symbol;
        bytes32 kind;
        uint16 aprBps;
        address vault;
    }

    TestnetToken internal usdc;
    AdapterRegistry internal registry;
    IndexFactory internal factory;
    address internal deployer;
    mapping(bytes32 => Strategy) internal strategies;
    bytes32[] internal strategyIds;
    address[] internal indexes;

    function run() external {
        require(_isTestnet(block.chainid), "TestnetDeploy: testnets only");
        vm.startBroadcast();
        (, deployer,) = vm.readCallers();
        Core memory c = _deployCore(deployer, deployer);
        registry = AdapterRegistry(c.registry);
        factory = IndexFactory(c.factory);

        usdc = new TestnetToken("Vectra Test USD Coin", "tUSDC", 6);
        _deployStrategies();
        address rwaCompliance = _deployIndexes();
        vm.stopBroadcast();

        _write(c, rwaCompliance);
    }

    function _isTestnet(uint256 id) internal pure returns (bool) {
        return id == 11155111 || id == 84532 || id == 421614 || id == 11155420 || id == 31337;
    }

    // --------------------------------------------------------------------- strategy vaults

    function _deployStrategies() internal {
        _strategy("G-PRIME", "Gauntlet-style USDC Prime (testnet)", "tgUSDCp", "MORPHO", 520);
        _strategy("G-CORE", "Gauntlet-style USDC Core (testnet)", "tgUSDCc", "MORPHO", 640);
        _strategy("G-FRONTIER", "Gauntlet-style USDC Frontier (testnet)", "tgUSDCf", "MORPHO", 910);
        _strategy("G-EULER", "Gauntlet-style Euler USDC (testnet)", "tgeUSDC", "EULER", 710);
        _strategy("E-MORPHO", "Edge-style USDC Morpho (testnet)", "teUSDCm", "MORPHO", 670);
        _strategy("E-EULER", "Edge-style Euler Prime USDC (testnet)", "teeUSDC", "EULER", 760);
        _strategy("RWA-TBILL", "Tokenized T-Bill Vault (testnet)", "tTBILL", "RWA", 480);
        _strategy("RWA-CREDIT", "Private Credit Vault (testnet)", "tCREDIT", "RWA", 1050);
    }

    function _strategy(string memory id, string memory name, string memory symbol, string memory kind, uint16 apr)
        internal
    {
        TestnetYieldVault v = new TestnetYieldVault(IERC20(address(usdc)), name, symbol, apr);
        usdc.setMinter(address(v), true);
        registry.setTargetApproved(address(v), true);
        bytes32 key = keccak256(bytes(id));
        strategies[key] = Strategy(name, symbol, keccak256(bytes(kind)), apr, address(v));
        strategyIds.push(key);
    }

    // --------------------------------------------------------------------- indexes

    function _deployIndexes() internal returns (address rwaCompliance) {
        _index("Edge Curated USDC Index", "EDGE-INDEX", 1000, _two("E-MORPHO", 5500, "E-EULER", 4500), 300_000e6);
        _index(
            "Gauntlet Curated USDC Index",
            "GAUNTLET-INDEX",
            1000,
            _four("G-PRIME", 3500, "G-CORE", 2500, "G-FRONTIER", 1500, "G-EULER", 2500),
            450_000e6
        );
        _index(
            "Gauntlet Morpho USDC Index",
            "GAUNTLET-MORPHO-INDEX",
            800,
            _three("G-PRIME", 5000, "G-CORE", 3000, "G-FRONTIER", 2000),
            350_000e6
        );
        _index(
            "Conservative USDC Yield",
            "vSAFE",
            1500,
            _three("G-PRIME", 4000, "RWA-TBILL", 4000, "E-MORPHO", 2000),
            200_000e6
        );
        _index(
            "High Yield USDC Blend",
            "vMAXY",
            1000,
            _three("G-FRONTIER", 4000, "E-EULER", 3500, "RWA-CREDIT", 2500),
            125_000e6
        );
        rwaCompliance = _rwaIndex();
    }

    function _rwaIndex() internal returns (address) {
        AllowlistCompliance compliance = new AllowlistCompliance(keccak256("VECTRA_RWA_TESTNET"), deployer, address(0));
        compliance.setEligibility(deployer, true, 0);
        IndexVault.IndexConfig memory cfg = _config("Tokenized Treasury & Credit Index", "RWA-INDEX", 500);
        cfg.complianceModule = address(compliance);
        _configure(IndexVault(factory.createIndex(cfg)), _two("RWA-TBILL", 7000, "RWA-CREDIT", 3000), 180_000e6);
        return address(compliance);
    }

    function _index(string memory name, string memory symbol, uint16 bufferBps, Weights memory w, uint256 seed)
        internal
    {
        _configure(IndexVault(factory.createIndex(_config(name, symbol, bufferBps))), w, seed);
    }

    struct Weights {
        bytes32[] ids;
        uint16[] bps;
    }

    function _configure(IndexVault v, Weights memory w, uint256 seed) internal {
        address[] memory adapters = new address[](w.ids.length);
        for (uint256 i = 0; i < w.ids.length; i++) {
            Strategy memory s = strategies[w.ids[i]];
            adapters[i] = v.deployAdapter(s.kind, s.vault, 50);
        }
        v.setAdapterWeights(adapters, w.bps);
        usdc.mint(deployer, seed);
        usdc.approve(address(v), seed);
        v.deposit(seed, 0, deployer);
        indexes.push(address(v));
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
            keeper: deployer,
            feeRecipient: deployer,
            complianceModule: address(0),
            managementFeeBps: 50,
            performanceFeeBps: 1000,
            liquidBufferBps: bufferBps,
            weightToleranceBps: 300,
            minDeposit: 10e6,
            minRedeem: 1e16,
            redemptionTtl: 7 days,
            maxQueueLength: 500,
            partialFillsEnabled: true
        });
    }

    function _two(string memory a, uint16 wa, string memory b, uint16 wb) internal pure returns (Weights memory w) {
        w.ids = new bytes32[](2);
        w.bps = new uint16[](2);
        (w.ids[0], w.bps[0]) = (keccak256(bytes(a)), wa);
        (w.ids[1], w.bps[1]) = (keccak256(bytes(b)), wb);
    }

    function _three(string memory a, uint16 wa, string memory b, uint16 wb, string memory c, uint16 wc)
        internal
        pure
        returns (Weights memory w)
    {
        w.ids = new bytes32[](3);
        w.bps = new uint16[](3);
        (w.ids[0], w.bps[0]) = (keccak256(bytes(a)), wa);
        (w.ids[1], w.bps[1]) = (keccak256(bytes(b)), wb);
        (w.ids[2], w.bps[2]) = (keccak256(bytes(c)), wc);
    }

    function _four(
        string memory a,
        uint16 wa,
        string memory b,
        uint16 wb,
        string memory c,
        uint16 wc,
        string memory d,
        uint16 wd
    ) internal pure returns (Weights memory w) {
        w.ids = new bytes32[](4);
        w.bps = new uint16[](4);
        (w.ids[0], w.bps[0]) = (keccak256(bytes(a)), wa);
        (w.ids[1], w.bps[1]) = (keccak256(bytes(b)), wb);
        (w.ids[2], w.bps[2]) = (keccak256(bytes(c)), wc);
        (w.ids[3], w.bps[3]) = (keccak256(bytes(d)), wd);
    }

    // --------------------------------------------------------------------- output

    function _write(Core memory c, address rwaCompliance) internal {
        string memory key = "testnet";
        _writeCore(c, key);
        vm.serializeAddress(key, "baseAsset", address(usdc));
        vm.serializeAddress(key, "rwaCompliance", rwaCompliance);
        vm.serializeBool(key, "testnet", true);
        address[] memory vaults = new address[](strategyIds.length);
        string memory strategiesJson = "strategies";
        for (uint256 i = 0; i < strategyIds.length; i++) {
            Strategy memory s = strategies[strategyIds[i]];
            vaults[i] = s.vault;
            string memory entry = vm.toString(i);
            vm.serializeString(entry, "name", s.name);
            vm.serializeString(entry, "symbol", s.symbol);
            vm.serializeUint(entry, "aprBps", s.aprBps);
            strategiesJson =
                vm.serializeString("strategies", vm.toString(s.vault), vm.serializeAddress(entry, "vault", s.vault));
        }
        vm.serializeString(key, "strategyVaults", strategiesJson);
        string memory json = vm.serializeAddress(key, "indexes", indexes);
        vm.writeJson(json, _deploymentPath());
    }
}
