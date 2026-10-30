// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategyAdapter} from "../../src/interfaces/IStrategyAdapter.sol";
import {IInitializableAdapter} from "../../src/AdapterRegistry.sol";

interface IAssetLike {
    function asset() external view returns (address);
}

/// @notice Configurable adapter used to test failure handling, malicious behaviour and reentrancy.
/// @dev Test-only. Deployed as a clone by the registry, so all defaults are set in `initialize`.
contract MockAdapter is IStrategyAdapter, IInitializableAdapter {
    using SafeERC20 for IERC20;

    bytes32 public constant KIND = keccak256("MOCK");

    address public override indexVault;
    address public override target;
    address public override asset;

    uint256 public reportedAssets;
    uint256 public maxDepositValue;
    uint256 public maxWithdrawValue;
    bool public healthy;
    bool public failDeposit;
    bool public failWithdraw;
    bool public failTotalAssets;
    bool public lieAboutWithdraw; // returns a large number but transfers less
    uint16 public withdrawHaircutBps;
    bytes public reentryCallData;
    bool public reentrySucceeded;

    modifier onlyVault() {
        require(msg.sender == indexVault, "not vault");
        _;
    }

    function initialize(address vault_, address target_, uint16) external override {
        require(indexVault == address(0), "init");
        indexVault = vault_;
        target = target_;
        asset = IAssetLike(target_).asset();
        maxDepositValue = type(uint256).max;
        maxWithdrawValue = type(uint256).max;
        healthy = true;
    }

    function setReportedAssets(uint256 value) external {
        reportedAssets = value;
    }

    function setLimits(uint256 maxDeposit_, uint256 maxWithdraw_) external {
        maxDepositValue = maxDeposit_;
        maxWithdrawValue = maxWithdraw_;
    }

    function setHealthy(bool value) external {
        healthy = value;
    }

    function setFailDeposit(bool value) external {
        failDeposit = value;
    }

    function setFailWithdraw(bool value) external {
        failWithdraw = value;
    }

    function setFailTotalAssets(bool value) external {
        failTotalAssets = value;
    }

    function setLieAboutWithdraw(bool value, uint16 haircutBps) external {
        lieAboutWithdraw = value;
        withdrawHaircutBps = haircutBps;
    }

    function setReentrancy(bytes calldata data) external {
        reentryCallData = data;
    }

    function kind() external pure override returns (bytes32) {
        return KIND;
    }

    function totalAssets() external view override returns (uint256) {
        require(!failTotalAssets, "valuation broken");
        return reportedAssets;
    }

    function maxDeposit() external view override returns (uint256) {
        return maxDepositValue;
    }

    function maxWithdraw() external view override returns (uint256) {
        return maxWithdrawValue;
    }

    function isHealthy() external view override returns (bool) {
        return healthy;
    }

    function deposit(uint256 assets) external override onlyVault returns (uint256 shares) {
        if (failDeposit) revert("deposit failed");
        if (reentryCallData.length != 0) {
            (bool ok,) = indexVault.call(reentryCallData);
            reentrySucceeded = ok;
        }
        IERC20(asset).safeTransferFrom(indexVault, address(this), assets);
        reportedAssets += assets;
        shares = assets;
    }

    function withdraw(uint256 assets) external override onlyVault returns (uint256 received) {
        if (failWithdraw) revert("withdraw failed");
        if (reentryCallData.length != 0) {
            (bool ok,) = indexVault.call(reentryCallData);
            reentrySucceeded = ok;
        }
        assets = assets > reportedAssets ? reportedAssets : assets;
        reportedAssets -= assets;
        received = assets - (assets * withdrawHaircutBps) / 10_000;
        IERC20(asset).safeTransfer(indexVault, received);
        if (lieAboutWithdraw) return type(uint128).max;
    }
}
