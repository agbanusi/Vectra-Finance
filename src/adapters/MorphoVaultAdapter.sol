// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseERC4626Adapter} from "./BaseERC4626Adapter.sol";

/// @notice MetaMorpho v1.1 bad-debt signal. MetaMorpho vaults (v1.0 and v1.1) are ERC-4626.
interface IMorphoVaultLike {
    function lostAssets() external view returns (uint256);
}

/// @title MorphoVaultAdapter
/// @notice Adapter for Morpho MetaMorpho vaults, with an additional bad-debt health signal.
/// @dev MetaMorpho vaults are synchronous ERC-4626; withdrawals are capped by idle + market
///      liquidity, which `maxWithdraw` reports. v1.1 vaults expose `lostAssets()` (bad debt not
///      socialised into the share price); a non-zero value marks the position unhealthy so no new
///      allocations are made. v1.0 vaults do not have this function and instead realise bad debt
///      directly in `totalAssets`, which the base adapter already values, so a revert there falls
///      back to the base health check. Curator risk parameters (caps, timelock, allocators) remain
///      external protocol configuration and must be reviewed before an adapter is deployed.
contract MorphoVaultAdapter is BaseERC4626Adapter {
    bytes32 public constant KIND = keccak256("MORPHO");

    function kind() public pure override returns (bytes32) {
        return KIND;
    }

    function isHealthy() public view override returns (bool) {
        if (!super.isHealthy()) return false;
        try IMorphoVaultLike(target).lostAssets() returns (uint256 lost) {
            return lost == 0;
        } catch {
            return true;
        }
    }
}
