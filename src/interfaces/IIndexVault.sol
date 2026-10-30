// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

/// @notice External surface of an index vault used by the factory, lens and integrations.
/// @dev The vault is itself the ERC-20 index token; `address(vault)` is the token address.
interface IIndexVault {
    enum RequestStatus {
        NONE,
        PENDING,
        PARTIALLY_FILLED,
        FULFILLED,
        CANCELLED,
        EXPIRED
    }

    struct AdapterConfig {
        address adapter;
        uint16 targetBps;
        bool enabled;
        bool quarantined;
    }

    struct RedemptionRequest {
        address owner;
        address receiver;
        uint256 shares;
        uint256 minAssetsOut;
        uint64 requestedAt;
        uint64 expiresAt;
        uint128 assetsPaid;
        RequestStatus status;
    }

    function factory() external view returns (address);

    function curator() external view returns (address);

    function baseAsset() external view returns (IERC20);

    function totalNav() external view returns (uint256);

    function availableLiquidity() external view returns (uint256);

    function reservedShares() external view returns (uint256);

    function reservedAssets() external view returns (uint256);

    function adaptersLength() external view returns (uint256);

    function adapterAt(uint256 index) external view returns (AdapterConfig memory);

    function redemptionRequest(uint256 id) external view returns (RedemptionRequest memory);

    function headRequestId() external view returns (uint64);

    function nextRequestId() external view returns (uint64);
}
