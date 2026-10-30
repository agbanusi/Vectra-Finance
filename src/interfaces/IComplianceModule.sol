// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IComplianceModule
/// @notice Pluggable eligibility policy for an index. Modules must revert when an action is not
///         permitted and return silently when it is. Implementations must never store personal data.
interface IComplianceModule {
    /// @notice Validate a deposit/mint into the index for `account` and the share `receiver`.
    function validateDeposit(address account, address receiver, uint256 assets) external view;

    /// @notice Validate a redemption request or claim for `account` paying out to `receiver`.
    function validateRedeem(address account, address receiver, uint256 shares) external view;

    /// @notice Validate a transfer of index shares.
    function validateTransfer(address from, address to, uint256 shares) external view;

    /// @notice Human-readable policy label for UI discovery (e.g. "permissionless", "allowlist").
    function policy() external view returns (string memory);
}
