// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Role identifiers shared by index vaults and the factory.
/// @dev Least privilege:
///      - DEFAULT_ADMIN_ROLE: protocol governance / timelock. Should be held by a multisig; no asset seizure powers.
///      - CURATOR_ROLE: economic configuration (weights, adapters, fees, buffer, compliance).
///      - KEEPER_ROLE: permissionless-safe automation (redemption processing, rebalancing within policy).
///      - PAUSER_ROLE: can pause new deposits/redemptions and trigger the irreversible emergency shutdown.
library Roles {
    bytes32 internal constant DEFAULT_ADMIN = 0x00;
    bytes32 internal constant CURATOR = keccak256("VECTRA_CURATOR_ROLE");
    bytes32 internal constant KEEPER = keccak256("VECTRA_KEEPER_ROLE");
    bytes32 internal constant PAUSER = keccak256("VECTRA_PAUSER_ROLE");
}
