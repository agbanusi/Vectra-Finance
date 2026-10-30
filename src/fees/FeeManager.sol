// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";

/// @title FeeManager
/// @notice Management and performance fee accounting for index vaults.
/// @dev Fees are paid by minting index shares to the fee recipient, never by moving base assets.
///      This keeps redemption liquidity and pending-claim reserves untouched. Dilution reduces NAV
///      per share for all holders (including escrowed redemption shares) uniformly.
///
///      Management fee: annualised on current NAV, pro-rated per second.
///      Performance fee: charged on the increase in NAV per share above a high-water mark, which is
///      only ratcheted upward. The high-water mark is recorded before dilution, which makes the
///      performance fee slightly conservative for fee recipients (never overcharges users).
abstract contract FeeManager {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant SECONDS_PER_YEAR = 365 days;
    uint256 internal constant WAD = 1e18;
    uint16 public constant MAX_MANAGEMENT_FEE_BPS = 2_000; // 20% / year
    uint16 public constant MAX_PERFORMANCE_FEE_BPS = 3_000; // 30% of gains

    error FeeTooHigh();
    error ZeroAddress();
    error NotInitialized();

    address public feeRecipient;
    uint16 public managementFeeBps;
    uint16 public performanceFeeBps;
    uint64 public lastFeeAccrual;
    uint256 public highWaterMarkWad;

    uint256[8] private __feeGap;

    event FeesAccrued(uint256 managementShares, uint256 performanceShares, uint256 nav, uint256 totalSupply);
    event FeeConfigUpdated(uint16 managementFeeBps, uint16 performanceFeeBps);
    event FeeRecipientUpdated(address indexed recipient);

    /// @dev Implemented by the vault; must use the same virtual-share conversion as deposits.
    function _convertToShares(uint256 assets, uint256 nav, uint256 supply) internal view virtual returns (uint256);

    function _mintShares(address to, uint256 amount) internal virtual;

    function _totalSupply() internal view virtual returns (uint256);

    function _feeRecipient() internal view returns (address) {
        address recipient = feeRecipient;
        if (recipient == address(0)) revert NotInitialized();
        return recipient;
    }

    function _initFees(address recipient_, uint16 managementFeeBps_, uint16 performanceFeeBps_) internal {
        if (recipient_ == address(0)) revert ZeroAddress();
        if (managementFeeBps_ > MAX_MANAGEMENT_FEE_BPS || performanceFeeBps_ > MAX_PERFORMANCE_FEE_BPS) {
            revert FeeTooHigh();
        }
        feeRecipient = recipient_;
        managementFeeBps = managementFeeBps_;
        performanceFeeBps = performanceFeeBps_;
        lastFeeAccrual = uint64(block.timestamp);
    }

    /// @notice Preview the shares that would be minted as fees if accrued right now.
    function previewFees() external view returns (uint256 managementShares, uint256 performanceShares) {
        (managementShares, performanceShares,) = _previewFees(_totalNavForFees(), _totalSupply());
    }

    /// @dev Vault supplies its NAV; kept abstract to avoid duplicating valuation logic.
    function _totalNavForFees() internal view virtual returns (uint256);

    function _previewFees(uint256 nav, uint256 supply)
        internal
        view
        returns (uint256 managementShares, uint256 performanceShares, uint256 newHighWaterMark)
    {
        uint64 dt = uint64(block.timestamp) - lastFeeAccrual;
        newHighWaterMark = highWaterMarkWad;
        if (dt == 0 || supply == 0 || nav == 0) return (0, 0, newHighWaterMark);

        uint256 navPerShare = Math.mulDiv(nav, WAD, supply);

        if (highWaterMarkWad != 0 && navPerShare > highWaterMarkWad) {
            uint256 gainAssets = Math.mulDiv(navPerShare - highWaterMarkWad, supply, WAD);
            uint256 perfAssets = Math.mulDiv(gainAssets, performanceFeeBps, BPS);
            performanceShares = _convertToShares(perfAssets, nav, supply);
        }
        if (navPerShare > newHighWaterMark) newHighWaterMark = navPerShare;

        uint256 mgmtAssets = Math.mulDiv(Math.mulDiv(nav, managementFeeBps, BPS), dt, SECONDS_PER_YEAR);
        managementShares = _convertToShares(mgmtAssets, nav, supply);
    }

    /// @notice Accrue and mint outstanding fees. `nav` and `supply` must reflect pre-fee state.
    function _accrueFees(uint256 nav, uint256 supply) internal returns (uint256 sharesMinted) {
        (uint256 managementShares, uint256 performanceShares, uint256 newHwm) = _previewFees(nav, supply);

        uint64 nowTs = uint64(block.timestamp);
        lastFeeAccrual = nowTs;
        if (supply == 0 || nav == 0) {
            highWaterMarkWad = 0;
            return 0;
        }

        highWaterMarkWad = newHwm;
        sharesMinted = managementShares + performanceShares;
        if (sharesMinted != 0) {
            _mintShares(_feeRecipient(), sharesMinted);
        }
        emit FeesAccrued(managementShares, performanceShares, nav, supply);
    }

    function _setFeeConfig(uint16 managementFeeBps_, uint16 performanceFeeBps_) internal {
        if (managementFeeBps_ > MAX_MANAGEMENT_FEE_BPS || performanceFeeBps_ > MAX_PERFORMANCE_FEE_BPS) {
            revert FeeTooHigh();
        }
        managementFeeBps = managementFeeBps_;
        performanceFeeBps = performanceFeeBps_;
        emit FeeConfigUpdated(managementFeeBps_, performanceFeeBps_);
    }

    function _setFeeRecipient(address recipient_) internal {
        if (recipient_ == address(0)) revert ZeroAddress();
        feeRecipient = recipient_;
        emit FeeRecipientUpdated(recipient_);
    }
}
