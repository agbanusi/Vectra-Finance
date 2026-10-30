// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "openzeppelin-contracts/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";

/// @title BaseERC4626Adapter
/// @notice Shared implementation for all ERC-4626 based integrations (plain 4626, Morpho, Euler, RWA).
/// @dev Deployed as a minimal-proxy clone by {AdapterRegistry}. The index vault is the only caller
///      able to move funds. Every value read uses the underlying vault's own exchange rate, never a
///      stored balance, so NAV cannot silently ignore share price changes.
abstract contract BaseERC4626Adapter is IStrategyAdapter, Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotVault();
    error ZeroAddress();
    error InvalidTarget();
    error CapExceeded();
    error ZeroShares();
    error SlippageExceeded();
    error TransferMismatch();

    /// @notice Maximum tolerated loss between assets in and reported value / assets out (bps).
    uint16 public constant MAX_SLIPPAGE_BPS = 500;

    address public override indexVault;
    address public override target;
    address public override asset;
    uint16 public slippageBps;

    /// @dev Implementation contracts are locked to prevent direct initialisation.
    constructor() {
        _disableInitializers();
    }

    function initialize(address vault_, address target_, uint16 slippageBps_) external initializer {
        if (vault_ == address(0) || target_ == address(0)) revert ZeroAddress();
        if (target_.code.length == 0) revert InvalidTarget();
        if (slippageBps_ > MAX_SLIPPAGE_BPS) revert SlippageExceeded();

        address targetAsset = IERC4626(target_).asset();
        if (targetAsset == address(0) || targetAsset.code.length == 0) revert InvalidTarget();

        indexVault = vault_;
        target = target_;
        asset = targetAsset;
        slippageBps = slippageBps_;
    }

    modifier onlyVault() {
        if (msg.sender != indexVault) revert NotVault();
        _;
    }

    function kind() public pure virtual returns (bytes32);

    function totalAssets() public view virtual override returns (uint256) {
        return IERC4626(target).previewRedeem(IERC4626(target).balanceOf(address(this)));
    }

    function maxDeposit() public view virtual override returns (uint256) {
        try IERC4626(target).maxDeposit(address(this)) returns (uint256 max) {
            return max;
        } catch {
            return 0;
        }
    }

    function maxWithdraw() public view virtual override returns (uint256) {
        try IERC4626(target).maxWithdraw(address(this)) returns (uint256 max) {
            return max;
        } catch {
            return 0;
        }
    }

    /// @dev Conservative health check: the position must be readable and its shares redeemable at a
    ///      non-reverting exchange rate. Protocol-specific adapters add their own solvency signals.
    function isHealthy() public view virtual override returns (bool) {
        try IERC4626(target).previewRedeem(IERC4626(target).balanceOf(address(this))) returns (uint256) {
            return true;
        } catch {
            return false;
        }
    }

    /// @inheritdoc IStrategyAdapter
    function deposit(uint256 assets) external override nonReentrant onlyVault returns (uint256 shares) {
        if (assets == 0) return 0;
        if (assets > maxDeposit()) revert CapExceeded();

        IERC20 token = IERC20(asset);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(indexVault, address(this), assets);
        if (token.balanceOf(address(this)) - balanceBefore != assets) revert TransferMismatch();

        token.forceApprove(target, assets);
        shares = IERC4626(target).deposit(assets, address(this));
        token.forceApprove(target, 0);

        if (shares == 0) revert ZeroShares();
        _requireWithinSlippage(IERC4626(target).previewRedeem(shares), assets);
        emit AdapterDeposit(indexVault, target, assets, shares);
    }

    /// @inheritdoc IStrategyAdapter
    /// @dev Withdraws by asset amount. Underlying vault caps must be respected by the caller;
    ///      protocol-specific withdrawal queues are not supported by this synchronous adapter.
    function withdraw(uint256 assets) external override nonReentrant onlyVault returns (uint256 received) {
        if (assets == 0) return 0;

        IERC20 token = IERC20(asset);
        uint256 balanceBefore = token.balanceOf(address(this));

        IERC4626(target).withdraw(assets, address(this), address(this));

        received = token.balanceOf(address(this)) - balanceBefore;
        _requireWithinSlippage(received, assets);
        token.safeTransfer(indexVault, received);
        emit AdapterWithdraw(indexVault, target, assets, received);
    }

    function _requireWithinSlippage(uint256 actual, uint256 expected) internal view {
        uint256 tolerance = (expected * slippageBps) / 10_000;
        if (actual + tolerance < expected) revert SlippageExceeded();
    }

    event AdapterDeposit(address indexed vault, address indexed target, uint256 assets, uint256 shares);
    event AdapterWithdraw(address indexed vault, address indexed target, uint256 requested, uint256 received);
}

