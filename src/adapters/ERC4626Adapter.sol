// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseERC4626Adapter} from "./BaseERC4626Adapter.sol";

/// @title ERC4626Adapter
/// @notice Adapter for standard, synchronous ERC-4626 vaults.
contract ERC4626Adapter is BaseERC4626Adapter {
    bytes32 public constant KIND = keccak256("ERC4626");

    function kind() public pure override returns (bytes32) {
        return KIND;
    }
}
