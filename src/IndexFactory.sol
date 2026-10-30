// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {Clones} from "openzeppelin-contracts/contracts/proxy/Clones.sol";
import {IndexVault} from "./IndexVault.sol";
import {AdapterRegistry} from "./AdapterRegistry.sol";

/// @title IndexFactory
/// @notice Deploys and registers index vaults as EIP-1167 clones of a reviewed implementation.
/// @dev The factory has no powers over existing indexes after creation (no upgrade, no admin
///      transfer, no asset access). Creation is restricted to `CREATOR_ROLE` so that the index
///      catalogue only lists curated products; the admin can pause creation entirely.
contract IndexFactory is AccessControl {
    using Clones for address;

    bytes32 public constant CREATOR_ROLE = keccak256("VECTRA_FACTORY_CREATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("VECTRA_FACTORY_PAUSER_ROLE");

    error CreationPaused();
    error ZeroAddress();
    error NotAContract();

    AdapterRegistry public immutable registry;
    address public immutable vaultImplementation;

    address[] private _indexes;
    mapping(address => bool) public isIndex;
    bool public creationPaused;

    event IndexCreated(
        address indexed vault,
        address indexed curator,
        address indexed baseAsset,
        string name,
        string symbol,
        address complianceModule
    );
    event CreationPausedUpdated(bool paused);

    constructor(address admin, address registry_, address vaultImplementation_) {
        if (admin == address(0) || registry_ == address(0) || vaultImplementation_ == address(0)) {
            revert ZeroAddress();
        }
        if (registry_.code.length == 0 || vaultImplementation_.code.length == 0) revert NotAContract();
        registry = AdapterRegistry(registry_);
        vaultImplementation = vaultImplementation_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(CREATOR_ROLE, admin);
    }

    /// @notice Create a new index. The caller supplies all initial roles and parameters.
    /// @return vault The index vault, which is also the index token.
    function createIndex(IndexVault.IndexConfig calldata cfg) external onlyRole(CREATOR_ROLE) returns (address vault) {
        if (creationPaused) revert CreationPaused();

        vault = vaultImplementation.clone();
        IndexVault(vault).initialize(cfg, address(registry));

        _indexes.push(vault);
        isIndex[vault] = true;
        emit IndexCreated(vault, cfg.curator, cfg.baseAsset, cfg.name, cfg.symbol, cfg.complianceModule);
    }

    function indexesLength() external view returns (uint256) {
        return _indexes.length;
    }

    function indexAt(uint256 index) external view returns (address) {
        return _indexes[index];
    }

    function allIndexes() external view returns (address[] memory) {
        return _indexes;
    }

    function setCreationPaused(bool paused) external onlyRole(PAUSER_ROLE) {
        creationPaused = paused;
        emit CreationPausedUpdated(paused);
    }
}
