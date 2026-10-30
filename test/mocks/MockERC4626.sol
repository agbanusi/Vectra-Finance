// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

/// @notice Faithful, configurable ERC-4626 mock used for unit, integration and invariant tests.
contract MockERC4626 is ERC20 {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    bool public depositsPaused;
    bool public withdrawalsDisabled;
    uint256 public depositCap = type(uint256).max;
    uint16 public redemptionFeeBps;
    uint16 public lossBps;

    constructor(IERC20 asset_, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        underlying = asset_;
    }

    function asset() external view returns (address) {
        return address(underlying);
    }

    function totalAssets() public view returns (uint256) {
        uint256 balance = underlying.balanceOf(address(this));
        return balance - (balance * lossBps) / 10_000;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 total = totalAssets();
        if (supply == 0 || total == 0) return assets;
        return Math.mulDiv(assets, supply, total);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        return Math.mulDiv(shares, totalAssets(), supply);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return Math.mulDiv(shares, totalAssets(), supply, Math.Rounding.Ceil);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return assets;
        return Math.mulDiv(assets, supply, totalAssets(), Math.Rounding.Ceil);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        uint256 assets = convertToAssets(shares);
        return assets - (assets * redemptionFeeBps) / 10_000;
    }

    function maxDeposit(address) public view returns (uint256) {
        if (depositsPaused) return 0;
        uint256 total = totalAssets();
        return total >= depositCap ? 0 : depositCap - total;
    }

    function maxWithdraw(address owner) public view returns (uint256) {
        if (withdrawalsDisabled || depositsPaused) return 0;
        return previewRedeem(balanceOf(owner));
    }

    function maxRedeem(address owner) public view returns (uint256) {
        if (withdrawalsDisabled || depositsPaused) return 0;
        return balanceOf(owner);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (depositsPaused) revert("deposits paused");
        require(assets <= maxDeposit(receiver), "cap");
        shares = convertToShares(assets);
        require(shares != 0, "zero shares");
        underlying.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
    }

    function mint(uint256 shares, address receiver) external returns (uint256 assets) {
        if (depositsPaused) revert("deposits paused");
        assets = previewMint(shares);
        underlying.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        if (withdrawalsDisabled || depositsPaused) revert("withdrawals disabled");
        shares = previewWithdraw(assets);
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        underlying.safeTransfer(receiver, assets);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        if (withdrawalsDisabled || depositsPaused) revert("withdrawals disabled");
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        assets = previewRedeem(shares);
        _burn(owner, shares);
        underlying.safeTransfer(receiver, assets);
    }

    // ------------------------------------------------------------------ test controls

    function setDepositsPaused(bool paused) external {
        depositsPaused = paused;
    }

    function setWithdrawalsDisabled(bool disabled) external {
        withdrawalsDisabled = disabled;
    }

    function setDepositCap(uint256 cap) external {
        depositCap = cap;
    }

    function setRedemptionFeeBps(uint16 bps) external {
        redemptionFeeBps = bps;
    }

    function setLossBps(uint16 bps) external {
        lossBps = bps;
    }

    /// @notice Simulate yield by transferring assets in without minting shares.
    function donate(uint256 assets) external {
        underlying.safeTransferFrom(msg.sender, address(this), assets);
    }
}
