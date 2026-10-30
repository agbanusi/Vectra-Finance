// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC4626} from "openzeppelin-contracts/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

interface ITestnetMintable {
    function mint(address to, uint256 amount) external;
}

/// @title TestnetYieldVault
/// @notice TESTNET ONLY. A standard OpenZeppelin ERC-4626 vault whose assets grow at a fixed simple APR,
///         emulating a curated lending strategy so index NAV, price per share and realised APY move on
///         a public testnet. Yield is minted from the faucet-mintable testnet asset. Not a real strategy;
///         never deploy on a production network.
/// @dev `totalAssets()` includes yield accrued since the last interaction; the yield is minted to the
///      vault (realised) at the start of every deposit/withdrawal, so share pricing is continuous.
contract TestnetYieldVault is ERC4626 {
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;
    uint16 public constant MAX_APR_BPS = 5_000;

    address public immutable owner;
    uint16 public aprBps;
    uint64 public lastAccrual;
    /// @notice Optional cap on withdrawable assets per call, to emulate limited strategy liquidity.
    uint256 public withdrawLiquidity = type(uint256).max;

    error NotOwner();
    error AprTooHigh();

    event AprUpdated(uint16 aprBps);
    event WithdrawLiquidityUpdated(uint256 liquidity);

    constructor(IERC20 asset_, string memory name_, string memory symbol_, uint16 aprBps_)
        ERC20(name_, symbol_)
        ERC4626(asset_)
    {
        if (aprBps_ > MAX_APR_BPS) revert AprTooHigh();
        owner = msg.sender;
        aprBps = aprBps_;
        lastAccrual = uint64(block.timestamp);
    }

    function pendingYield() public view returns (uint256) {
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        return Math.mulDiv(balance, uint256(aprBps) * (block.timestamp - lastAccrual), BPS * YEAR);
    }

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + pendingYield();
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner_), withdrawLiquidity);
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        return Math.min(super.maxRedeem(owner_), convertToShares(withdrawLiquidity));
    }

    function setApr(uint16 aprBps_) external {
        if (msg.sender != owner) revert NotOwner();
        if (aprBps_ > MAX_APR_BPS) revert AprTooHigh();
        _realize();
        aprBps = aprBps_;
        emit AprUpdated(aprBps_);
    }

    function setWithdrawLiquidity(uint256 liquidity) external {
        if (msg.sender != owner) revert NotOwner();
        withdrawLiquidity = liquidity;
        emit WithdrawLiquidityUpdated(liquidity);
    }

    /// @notice Anyone may realise accrued yield; it does not change share prices.
    function realize() external {
        _realize();
    }

    function _realize() internal {
        uint256 pending = pendingYield();
        lastAccrual = uint64(block.timestamp);
        if (pending != 0) ITestnetMintable(asset()).mint(address(this), pending);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        _realize();
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
    {
        _realize();
        super._withdraw(caller, receiver, owner_, assets, shares);
    }
}
