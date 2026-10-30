// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseERC4626Adapter} from "./BaseERC4626Adapter.sol";

/// @title RWAAdapter
/// @notice Adapter for tokenised real-world-asset vaults that expose a synchronous ERC-4626 surface.
/// @dev Only vaults whose shares are freely (subject to issuer allowlists) redeemable synchronously
///      may use this adapter. Vaults with request/claim (ERC-7540 style) withdrawal queues are NOT
///      supported by this synchronous adapter; integrating them requires a separate verified adapter
///      implementation and is intentionally not approximated here. Underlying issuer transfer
///      restrictions are enforced by the token/vault itself and cannot be bypassed by this contract.
///      Restricted RWA indexes must also configure a compliance module at the index level.
contract RWAAdapter is BaseERC4626Adapter {
    bytes32 public constant KIND = keccak256("RWA");

    function kind() public pure override returns (bytes32) {
        return KIND;
    }
}
