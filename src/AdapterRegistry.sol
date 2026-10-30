// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {Clones} from "openzeppelin-contracts/contracts/proxy/Clones.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";

/// @notice Initialisation hook used by the registry when cloning an adapter implementation.
interface IInitializableAdapter {
    function initialize(address indexVault, address target, uint16 slippageBps) external;
}

/// @title AdapterRegistry
/// @notice Governance-controlled allowlists of reviewed adapter implementations and of vetted
///         underlying positions, plus a factory for per-position adapter clones.
/// @dev Adding a new protocol integration requires deploying and reviewing a new implementation and
///      approving it here; the core vault does not change. Existing clones remain bound to the
///      implementation they were created from. Registry governance can stop *new* positions but
///      cannot move funds out of existing adapters.
contract AdapterRegistry is AccessControl {
    using Clones for address;

    error ImplementationNotApproved(bytes32 kind);
    error TargetNotApproved(address target);
    error ZeroAddress();
    error NotAContract();

    struct Implementation {
        address implementation;
        bool approved;
    }

    mapping(bytes32 => Implementation) public implementations;
    mapping(address => bool) public isAdapter;
    mapping(address => bytes32) public adapterKind;
    /// @notice Underlying positions (e.g. ERC-4626 vaults) that curators may integrate. Vetting a
    ///         target (asset, liquidity, permissions, curator risk) is a governance decision, so a
    ///         compromised curator cannot route index funds to an arbitrary contract.
    mapping(address => bool) public approvedTarget;

    event ImplementationSet(bytes32 indexed kind, address indexed implementation, bool approved);
    event TargetApprovalSet(address indexed target, bool approved);
    event AdapterCreated(bytes32 indexed kind, address indexed adapter, address indexed indexVault, address target);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Approve or revoke (for future deployments) an adapter implementation.
    function setImplementation(bytes32 kind, address implementation, bool approved)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (implementation == address(0)) revert ZeroAddress();
        if (implementation.code.length == 0) revert NotAContract();
        implementations[kind] = Implementation({implementation: implementation, approved: approved});
        emit ImplementationSet(kind, implementation, approved);
    }

    /// @notice Approve or revoke an underlying position for *new* adapters. Existing adapters keep
    ///         working so revocation can never trap funds.
    function setTargetApproved(address target, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress();
        if (target.code.length == 0) revert NotAContract();
        approvedTarget[target] = approved;
        emit TargetApprovalSet(target, approved);
    }

    /// @notice Deploy a minimal-proxy adapter bound to the calling index vault and `target`.
    /// @dev Only the calling vault becomes the adapter's `indexVault`, so anyone may safely create
    ///      an adapter they control; it can never move another index's funds.
    function createAdapter(bytes32 kind, address target, uint16 slippageBps) external returns (address adapter) {
        Implementation memory impl = implementations[kind];
        if (!impl.approved) revert ImplementationNotApproved(kind);
        if (!approvedTarget[target]) revert TargetNotApproved(target);

        adapter = impl.implementation.clone();
        IInitializableAdapter(adapter).initialize(msg.sender, target, slippageBps);

        isAdapter[adapter] = true;
        adapterKind[adapter] = kind;
        emit AdapterCreated(kind, adapter, msg.sender, target);
    }

    /// @notice Convenience view returning the adapter's normalised interface.
    function adapterAt(address adapter) external pure returns (IStrategyAdapter) {
        return IStrategyAdapter(adapter);
    }
}
