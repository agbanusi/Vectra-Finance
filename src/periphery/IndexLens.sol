// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {IndexVault} from "../IndexVault.sol";
import {IIndexVault} from "../interfaces/IIndexVault.sol";
import {IStrategyAdapter} from "../interfaces/IStrategyAdapter.sol";
import {IComplianceModule} from "../interfaces/IComplianceModule.sol";

/// @title IndexLens
/// @notice Stateless, read-only aggregation for frontends, the API and keepers. Never reverts on a
///         single unhealthy adapter: failures are reported as flags instead.
/// @dev Holds no privileges and no funds; safe to redeploy at will.
contract IndexLens {
    struct AdapterView {
        address adapter;
        bytes32 kind;
        address target;
        uint16 targetBps;
        bool enabled;
        bool quarantined;
        bool healthy;
        bool valuationOk;
        uint256 totalAssets;
        uint256 maxDeposit;
        uint256 maxWithdraw;
        uint256 targetAssets;
    }

    struct IndexView {
        address vault;
        string name;
        string symbol;
        address baseAsset;
        uint8 baseDecimals;
        address curator;
        string compliancePolicy;
        address complianceModule;
        uint256 totalSupply;
        uint256 nav;
        bool navHealthy;
        uint256 pricePerShare;
        uint256 baseBalance;
        uint256 reservedShares;
        uint256 reservedAssets;
        uint256 availableLiquidity;
        uint16 liquidBufferBps;
        uint16 weightToleranceBps;
        uint16 managementFeeBps;
        uint16 performanceFeeBps;
        uint256 minDeposit;
        uint256 minRedeem;
        uint64 redemptionTtl;
        uint32 pendingRequests;
        uint32 maxQueueLength;
        uint64 headRequestId;
        uint64 nextRequestId;
        bool partialFillsEnabled;
        bool depositsPaused;
        bool redemptionsPaused;
        bool shutdown;
        uint64 configVersion;
        AdapterView[] adapters;
    }

    struct UserView {
        uint256 shares;
        uint256 value;
        uint256 baseBalance;
        uint256 baseAllowance;
    }

    function getIndex(IndexVault vault) public view returns (IndexView memory v) {
        v.vault = address(vault);
        v.name = vault.name();
        v.symbol = vault.symbol();
        v.baseAsset = address(vault.baseAsset());
        v.baseDecimals = vault.baseDecimals();
        v.curator = vault.curator();
        v.complianceModule = address(vault.compliance());
        v.compliancePolicy = _policy(v.complianceModule);
        v.totalSupply = vault.totalSupply();
        v.baseBalance = IERC20Metadata(v.baseAsset).balanceOf(address(vault));
        v.adapters = getAdapters(vault);

        uint256 nav = v.baseBalance;
        v.navHealthy = true;
        for (uint256 i = 0; i < v.adapters.length; i++) {
            AdapterView memory a = v.adapters[i];
            if (a.quarantined) continue;
            if (!a.valuationOk) v.navHealthy = false;
            nav += a.totalAssets;
        }
        v.nav = nav;
        _fillDerived(vault, v);
    }

    function _fillDerived(IndexVault vault, IndexView memory v) internal view {
        v.reservedShares = vault.reservedShares();
        if (v.totalSupply != 0) {
            v.pricePerShare = Math.mulDiv(v.nav, 1e18, v.totalSupply);
            v.reservedAssets = Math.mulDiv(v.reservedShares, v.nav, v.totalSupply, Math.Rounding.Ceil);
        }
        v.availableLiquidity = v.baseBalance > v.reservedAssets ? v.baseBalance - v.reservedAssets : 0;
        v.liquidBufferBps = vault.liquidBufferBps();
        v.weightToleranceBps = vault.weightToleranceBps();
        v.managementFeeBps = vault.managementFeeBps();
        v.performanceFeeBps = vault.performanceFeeBps();
        v.minDeposit = vault.minDeposit();
        v.minRedeem = vault.minRedeem();
        v.redemptionTtl = vault.redemptionTtl();
        v.pendingRequests = vault.pendingRequests();
        v.maxQueueLength = vault.maxQueueLength();
        v.headRequestId = vault.headRequestId();
        v.nextRequestId = vault.nextRequestId();
        v.partialFillsEnabled = vault.partialFillsEnabled();
        v.depositsPaused = vault.depositsPaused();
        v.redemptionsPaused = vault.redemptionsPaused();
        v.shutdown = vault.shutdown();
        v.configVersion = vault.configVersion();
        _fillTargets(v);
    }

    /// @dev Target assets per adapter mirror the vault: buffer% of (NAV − reserved) stays liquid.
    function _fillTargets(IndexView memory v) internal pure {
        uint256 deployable = v.nav > v.reservedAssets ? v.nav - v.reservedAssets : 0;
        uint256 invested = Math.mulDiv(deployable, 10_000 - v.liquidBufferBps, 10_000);
        for (uint256 i = 0; i < v.adapters.length; i++) {
            v.adapters[i].targetAssets = Math.mulDiv(invested, v.adapters[i].targetBps, 10_000);
        }
    }

    function getAdapters(IndexVault vault) public view returns (AdapterView[] memory list) {
        uint256 len = vault.adaptersLength();
        list = new AdapterView[](len);
        for (uint256 i = 0; i < len; i++) {
            list[i] = _adapterView(vault.adapterAt(i));
        }
    }

    function _adapterView(IIndexVault.AdapterConfig memory cfg) internal view returns (AdapterView memory a) {
        IStrategyAdapter s = IStrategyAdapter(cfg.adapter);
        a.adapter = cfg.adapter;
        a.targetBps = cfg.targetBps;
        a.enabled = cfg.enabled;
        a.quarantined = cfg.quarantined;
        try s.kind() returns (bytes32 k) {
            a.kind = k;
        } catch {}
        try s.target() returns (address t) {
            a.target = t;
        } catch {}
        try s.isHealthy() returns (bool ok) {
            a.healthy = ok;
        } catch {}
        try s.totalAssets() returns (uint256 value) {
            a.totalAssets = value;
            a.valuationOk = true;
        } catch {}
        try s.maxDeposit() returns (uint256 value) {
            a.maxDeposit = value;
        } catch {}
        try s.maxWithdraw() returns (uint256 value) {
            a.maxWithdraw = value;
        } catch {}
    }

    function getIndexes(IndexVault[] calldata vaults) external view returns (IndexView[] memory list) {
        list = new IndexView[](vaults.length);
        for (uint256 i = 0; i < vaults.length; i++) {
            list[i] = getIndex(vaults[i]);
        }
    }

    function getUser(IndexVault vault, address user) external view returns (UserView memory u) {
        u.shares = vault.balanceOf(user);
        uint256 supply = vault.totalSupply();
        if (supply != 0 && u.shares != 0) {
            try vault.totalNav() returns (uint256 nav) {
                u.value = Math.mulDiv(u.shares, nav, supply);
            } catch {}
        }
        IERC20Metadata base = IERC20Metadata(address(vault.baseAsset()));
        u.baseBalance = base.balanceOf(user);
        u.baseAllowance = base.allowance(user, address(vault));
    }

    /// @notice Open (pending / partially filled) requests between `fromId` and `toId` (exclusive).
    function getRequests(IndexVault vault, uint256 fromId, uint256 toId)
        external
        view
        returns (uint256[] memory ids, IIndexVault.RedemptionRequest[] memory requests)
    {
        uint256 next = vault.nextRequestId();
        if (toId > next) toId = next;
        uint256 count = toId > fromId ? toId - fromId : 0;
        ids = new uint256[](count);
        requests = new IIndexVault.RedemptionRequest[](count);
        for (uint256 i = 0; i < count; i++) {
            ids[i] = fromId + i;
            requests[i] = vault.redemptionRequest(fromId + i);
        }
    }

    /// @notice Shares a deposit would mint right now, including fee shares the deposit will accrue.
    function previewDeposit(IndexVault vault, uint256 assets) external view returns (uint256) {
        (uint256 nav, uint256 supply) = _postFeeState(vault);
        return Math.mulDiv(assets, supply + vault.virtualShares(), nav + 1);
    }

    /// @notice Assets an instant redemption would pay right now, and the free liquidity available to
    ///         pay it. If `assets > available` the redemption can only be queued.
    function previewRedeem(IndexVault vault, uint256 shares) external view returns (uint256 assets, uint256 available) {
        (uint256 nav, uint256 supply) = _postFeeState(vault);
        if (supply == 0) return (0, 0);
        assets = Math.mulDiv(shares, nav, supply);
        uint256 reserved = Math.mulDiv(vault.reservedShares(), nav, supply, Math.Rounding.Ceil);
        uint256 balance = vault.baseAsset().balanceOf(address(vault));
        available = balance > reserved ? balance - reserved : 0;
    }

    /// @notice Estimated payout of a queued request at current NAV (actual payout uses fill-time NAV).
    function previewRequest(IndexVault vault, uint256 id) external view returns (uint256) {
        (uint256 nav, uint256 supply) = _postFeeState(vault);
        if (supply == 0) return 0;
        return Math.mulDiv(vault.redemptionRequest(id).shares, nav, supply);
    }

    function _postFeeState(IndexVault vault) internal view returns (uint256 nav, uint256 supply) {
        nav = vault.totalNav();
        (uint256 mgmt, uint256 perf) = vault.previewFees();
        supply = vault.totalSupply() + mgmt + perf;
    }

    function _policy(address module) internal view returns (string memory) {
        if (module == address(0)) return "permissionless";
        try IComplianceModule(module).policy() returns (string memory p) {
            return p;
        } catch {
            return "unknown";
        }
    }
}
