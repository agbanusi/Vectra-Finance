// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseERC4626Adapter} from "./BaseERC4626Adapter.sol";

/// @title EulerVaultAdapter
/// @notice Adapter for Euler v2 EVaults used as lending (supply-only) positions.
/// @dev EVaults implement ERC-4626. The index only supplies the vault's `asset()` (checked at
///      initialisation), so the EVault's `unitOfAccount` — which prices borrower collateral and is
///      commonly USD rather than the asset — is irrelevant to depositor value and is NOT used as a
///      health signal. Operations disabled by hooks or caps surface through the ERC-4626 `maxDeposit`
///      / `maxWithdraw` views, which the vault respects. Withdrawals are limited by the vault's cash
///      (borrowed assets are not instantly withdrawable); `maxWithdraw` reflects that limit.
contract EulerVaultAdapter is BaseERC4626Adapter {
    bytes32 public constant KIND = keccak256("EULER");

    function kind() public pure override returns (bytes32) {
        return KIND;
    }
}
