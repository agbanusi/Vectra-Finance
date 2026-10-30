// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IComplianceModule} from "../interfaces/IComplianceModule.sol";

/// @title PermissionlessCompliance
/// @notice No-op policy for indexes composed exclusively of permissionless assets.
/// @dev Underlying tokens still enforce any of their own restrictions; the index cannot bypass them.
contract PermissionlessCompliance is IComplianceModule {
    function validateDeposit(address, address, uint256) external pure override {}

    function validateRedeem(address, address, uint256) external pure override {}

    function validateTransfer(address, address, uint256) external pure override {}

    function policy() external pure override returns (string memory) {
        return "permissionless";
    }
}
