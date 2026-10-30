// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IStrategyAdapter
/// @notice Normalises interaction with a single underlying yield position on behalf of one index vault.
/// @dev Adapters are deployed per (index vault, underlying position) pair so that balances and
///      failure modes are isolated. They are the only contracts authorised to move an index's
///      assets into an integrated protocol.
interface IStrategyAdapter {
    /// @notice Identifier of the integration family (e.g. keccak256("ERC4626")).
    function kind() external view returns (bytes32);

    /// @notice Index vault that owns this adapter position.
    function indexVault() external view returns (address);

    /// @notice Underlying position contract (for ERC-4626 integrations: the vault).
    function target() external view returns (address);

    /// @notice Base/settlement asset shared by the index and the underlying position.
    function asset() external view returns (address);

    /// @notice Current value of the position denominated in `asset`, using on-chain exchange rates.
    function totalAssets() external view returns (uint256);

    /// @notice Maximum amount of `asset` that can be deposited right now.
    function maxDeposit() external view returns (uint256);

    /// @notice Maximum amount of `asset` that can be withdrawn right now.
    function maxWithdraw() external view returns (uint256);

    /// @notice Whether the underlying position is currently usable (not paused, solvent, compatible).
    function isHealthy() external view returns (bool);

    /// @notice Pull `assets` from the index vault and deposit into the underlying position.
    /// @return shares Underlying shares received.
    function deposit(uint256 assets) external returns (uint256 shares);

    /// @notice Withdraw approximately `assets` from the underlying position and return them to the vault.
    /// @return assetsReceived Amount of `asset` actually returned to the index vault.
    function withdraw(uint256 assets) external returns (uint256 assetsReceived);
}
