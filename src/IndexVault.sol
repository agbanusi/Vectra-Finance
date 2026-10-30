// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "openzeppelin-contracts/contracts/proxy/utils/Initializable.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "openzeppelin-contracts/contracts/utils/math/Math.sol";
import {SafeCast} from "openzeppelin-contracts/contracts/utils/math/SafeCast.sol";

import {IIndexVault} from "./interfaces/IIndexVault.sol";
import {IComplianceModule} from "./interfaces/IComplianceModule.sol";
import {IStrategyAdapter} from "./interfaces/IStrategyAdapter.sol";
import {AdapterRegistry} from "./AdapterRegistry.sol";
import {FeeManager} from "./fees/FeeManager.sol";
import {Roles} from "./AccessRoles.sol";

/// @title IndexVault
/// @notice Owns an index's assets, is the ERC-20 index token, maintains a liquid buffer and operates
///         a FIFO redemption queue for illiquid periods.
///
/// Accounting model (single settlement asset):
///   NAV = base asset held by the vault + Σ adapter.totalAssets() over non-quarantined adapters.
///   Each adapter values its position through the underlying protocol's own exchange rate
///   (`previewRedeem` of shares held), never through a cached balance. All integrated positions must
///   settle in the index base asset; cross-asset positions require an oracle and are rejected.
///
///   Shares are priced with a virtual-share offset to mitigate first-depositor donation attacks:
///     shares = assets * (supply + virtualShares) / (nav + 1)
///   Redemptions pay exact proportional ownership: assets = floor(shares * nav / supply).
///
/// Redemption model:
///   - Instant redemptions are paid only from free liquidity (base balance minus assets owed to
///     escrowed queue shares). Adapters are never force-liquidated inside a user redemption, so a
///     run cannot force fire-sales or let early redeemers skip the queue.
///   - If free liquidity is insufficient, shares are escrowed in the vault and a FIFO request is
///     created. Claims are priced at fulfilment-time NAV with the request's `minAssetsOut` as a
///     floor, so every queued holder bears the same NAV as remaining holders (no stale prices).
///   - `reservedShares` tracks all escrowed shares; reserved assets are recomputed at current NAV in
///     O(1), so deposits and instant redemptions can never consume liquidity owed to the queue.
///   - Keepers restore liquidity (`rebalance`, `pullFromAdapter`); anyone may then call
///     `processRedemptions`, which can only pay recorded receivers at on-chain NAV.
///
/// Deployment: EIP-1167 clones created by {IndexFactory}. No upgrade path: new economics require a
/// new index, which avoids proxy-admin risk over user funds.
contract IndexVault is IIndexVault, ERC20, AccessControl, ReentrancyGuard, Initializable, FeeManager {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ADAPTERS = 16;
    uint256 public constant MAX_LIQUID_BUFFER_BPS = 9_000;
    uint256 public constant MAX_WEIGHT_TOLERANCE_BPS = 2_000;
    uint256 public constant MAX_QUEUE_LENGTH = 1_000;
    uint256 public constant MAX_REDEMPTION_TTL = 365 days;
    uint256 public constant MIN_REDEMPTION_TTL = 1 hours;

    error ZeroAmount();
    error NotAContract();
    error BelowMinimum();
    error InvalidParameter();
    error DepositsPaused();
    error RedemptionsPaused();
    error InsufficientShares();
    error InsufficientLiquidity(uint256 required, uint256 available);
    error SlippageExceeded();
    error QueueFull();
    error AdapterNotApproved();
    error AdapterMismatch();
    error TooManyAdapters();
    error InvalidWeights();
    error InvalidAdapterState();
    error InvalidRequestStatus();
    error NotRequestOwner();
    error RequestNotExpired();
    error NonStandardTransfer();
    error TransferToVault();
    error ExceedsTarget();

    struct IndexConfig {
        string name;
        string symbol;
        address baseAsset;
        address admin;
        address curator;
        address guardian;
        address keeper;
        address feeRecipient;
        address complianceModule; // address(0) => permissionless
        uint16 managementFeeBps;
        uint16 performanceFeeBps;
        uint16 liquidBufferBps;
        uint16 weightToleranceBps;
        uint256 minDeposit;
        uint256 minRedeem;
        uint64 redemptionTtl;
        uint32 maxQueueLength;
        bool partialFillsEnabled;
    }

    address public override factory;
    address public override curator;

    string private _indexName;
    string private _indexSymbol;

    IERC20 public override baseAsset;
    uint8 public baseDecimals;
    IComplianceModule public compliance;
    AdapterRegistry public registry;

    AdapterConfig[] private _adapters;
    mapping(address => uint256) private _adapterIndexPlusOne;

    uint256 public virtualShares;
    uint16 public liquidBufferBps;
    uint16 public weightToleranceBps;
    uint256 public minDeposit;
    uint256 public minRedeem;
    uint64 public redemptionTtl;
    uint32 public maxQueueLength;
    bool public partialFillsEnabled;
    bool public depositsPaused;
    bool public redemptionsPaused;
    bool public shutdown;
    uint64 public configVersion;

    uint256 public override reservedShares;
    uint32 public pendingRequests;
    uint64 public override nextRequestId;
    uint64 public override headRequestId;
    mapping(uint256 => RedemptionRequest) private _requests;

    event IndexInitialized(address indexed factory, address indexed baseAsset, address indexed curator);
    event Deposited(address indexed payer, address indexed receiver, uint256 assets, uint256 shares);
    event Redeemed(address indexed owner, address indexed receiver, uint256 shares, uint256 assets);
    event LiquidityRaised(uint256 requested, uint256 received);
    event AdapterAllocated(address indexed adapter, uint256 assets, uint256 shares);
    event AdapterDepositSkipped(address indexed adapter, uint256 assets);
    event AdapterLiquidityPulled(address indexed adapter, uint256 requested, uint256 received);
    event AdapterWithdrawSkipped(address indexed adapter, uint256 assets);
    event AdapterUnhealthy(address indexed adapter);
    event AdapterDeployed(address indexed adapter, bytes32 indexed kind, address indexed target);
    event AdapterWeightsUpdated(uint64 indexed version, uint256 adapterCount);
    event AdapterEnabled(address indexed adapter, bool enabled);
    event AdapterQuarantined(address indexed adapter, bool quarantined);
    event AdapterRemoved(address indexed adapter);
    event LiquidityParamsUpdated(uint256 liquidBufferBps, uint256 weightToleranceBps);
    event LimitsUpdated(
        uint256 minDeposit, uint256 minRedeem, uint256 redemptionTtl, uint256 maxQueueLength, bool partialFills
    );
    event ComplianceUpdated(address indexed module);
    event CuratorUpdated(address indexed curator);
    event DepositsPausedUpdated(bool paused);
    event RedemptionsPausedUpdated(bool paused);
    event EmergencyShutdownTriggered(address indexed by);
    event RedemptionRequested(
        uint256 indexed requestId,
        address indexed owner,
        address indexed receiver,
        uint256 shares,
        uint256 minAssetsOut,
        uint64 expiresAt
    );
    event RedemptionPartiallyFilled(
        uint256 indexed requestId, address indexed receiver, uint256 sharesBurned, uint256 assetsPaid
    );
    event RedemptionFilled(
        uint256 indexed requestId, address indexed receiver, uint256 sharesBurned, uint256 assetsPaid
    );
    event RedemptionCancelled(uint256 indexed requestId, address indexed recipient, uint256 shares);
    event RedemptionExpired(uint256 indexed requestId, address indexed recipient, uint256 shares);
    event RedemptionPaymentBlocked(uint256 indexed requestId, address indexed owner, address indexed receiver);
    event Rebalanced(uint256 raised, uint256 allocated);

    /// @dev The implementation is locked; only clones are initialised.
    constructor() ERC20("", "") {
        _disableInitializers();
    }

    // ---------------------------------------------------------------------------------------------
    // Initialisation
    // ---------------------------------------------------------------------------------------------

    /// @notice Initialise a freshly cloned vault. The caller is recorded as the factory.
    /// @dev The factory clones and initialises atomically, so initialisation cannot be front-run.
    function initialize(IndexConfig calldata cfg, address registry_) external initializer {
        _validateInitConfig(cfg, registry_);

        factory = msg.sender;
        _indexName = cfg.name;
        _indexSymbol = cfg.symbol;

        baseAsset = IERC20(cfg.baseAsset);
        uint8 decimals_ = IERC20Metadata(cfg.baseAsset).decimals();
        if (decimals_ > 18) revert InvalidParameter();
        baseDecimals = decimals_;
        virtualShares = 10 ** (18 - decimals_);

        registry = AdapterRegistry(registry_);
        compliance = IComplianceModule(cfg.complianceModule);
        curator = cfg.curator;

        liquidBufferBps = cfg.liquidBufferBps;
        weightToleranceBps = cfg.weightToleranceBps;
        minDeposit = cfg.minDeposit;
        minRedeem = cfg.minRedeem;
        redemptionTtl = cfg.redemptionTtl;
        maxQueueLength = cfg.maxQueueLength;
        partialFillsEnabled = cfg.partialFillsEnabled;
        configVersion = 1;
        nextRequestId = 1;
        headRequestId = 1;

        _initFees(cfg.feeRecipient, cfg.managementFeeBps, cfg.performanceFeeBps);

        _grantRole(DEFAULT_ADMIN_ROLE, cfg.admin);
        _grantRole(Roles.CURATOR, cfg.curator);
        _grantRole(Roles.PAUSER, cfg.guardian);
        if (cfg.keeper != address(0)) _grantRole(Roles.KEEPER, cfg.keeper);

        emit IndexInitialized(msg.sender, cfg.baseAsset, cfg.curator);
    }

    function _validateInitConfig(IndexConfig calldata cfg, address registry_) internal view {
        if (
            cfg.baseAsset == address(0) || cfg.admin == address(0) || cfg.curator == address(0)
                || cfg.guardian == address(0)
        ) revert ZeroAddress();
        if (cfg.baseAsset.code.length == 0 || registry_.code.length == 0) revert NotAContract();
        if (cfg.complianceModule != address(0) && cfg.complianceModule.code.length == 0) revert NotAContract();
        _validateLiquidity(cfg.liquidBufferBps, cfg.weightToleranceBps);
        _validateLimits(cfg.minDeposit, cfg.minRedeem, cfg.redemptionTtl, cfg.maxQueueLength);
    }

    // ---------------------------------------------------------------------------------------------
    // ERC-20 metadata
    // ---------------------------------------------------------------------------------------------

    function name() public view override returns (string memory) {
        return _indexName;
    }

    function symbol() public view override returns (string memory) {
        return _indexSymbol;
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @inheritdoc IIndexVault
    function totalNav() public view override returns (uint256 nav) {
        nav = baseAsset.balanceOf(address(this));
        uint256 len = _adapters.length;
        for (uint256 i = 0; i < len; i++) {
            AdapterConfig storage cfg = _adapters[i];
            if (cfg.quarantined) continue;
            nav += IStrategyAdapter(cfg.adapter).totalAssets();
        }
    }

    /// @dev Assets owed to escrowed queue shares, valued at current NAV. Rounded up (conservative).
    function reservedAssets() public view override returns (uint256) {
        return _reservedAssets(totalNav(), totalSupply());
    }

    /// @inheritdoc IIndexVault
    function availableLiquidity() public view override returns (uint256) {
        uint256 balance = baseAsset.balanceOf(address(this));
        uint256 reserved = reservedAssets();
        return balance > reserved ? balance - reserved : 0;
    }

    function adaptersLength() external view override returns (uint256) {
        return _adapters.length;
    }

    function adapterAt(uint256 index) external view override returns (AdapterConfig memory) {
        return _adapters[index];
    }

    /// @inheritdoc IIndexVault
    function redemptionRequest(uint256 id) external view override returns (RedemptionRequest memory) {
        return _requests[id];
    }

    // ---------------------------------------------------------------------------------------------
    // Deposits and issuance
    // ---------------------------------------------------------------------------------------------

    /// @notice Deposit `assets` of the base asset and mint index shares to `receiver`.
    /// @param minShares Slippage floor on minted shares.
    function deposit(uint256 assets, uint256 minShares, address receiver)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (depositsPaused) revert DepositsPaused();
        if (receiver == address(0)) revert ZeroAddress();
        if (assets == 0) revert ZeroAmount();
        if (assets < minDeposit) revert BelowMinimum();
        IComplianceModule module = compliance;
        if (address(module) != address(0)) module.validateDeposit(msg.sender, receiver, assets);

        _accrueFeesWithNav();

        shares = _convertToShares(assets, totalNav(), totalSupply());
        if (shares == 0) revert ZeroAmount();
        if (shares < minShares) revert SlippageExceeded();

        uint256 balanceBefore = baseAsset.balanceOf(address(this));
        baseAsset.safeTransferFrom(msg.sender, address(this), assets);
        // Fee-on-transfer / rebasing settlement assets are not supported: silent shortfalls would
        // under-collateralise existing holders.
        if (baseAsset.balanceOf(address(this)) - balanceBefore != assets) revert NonStandardTransfer();

        _mint(receiver, shares);
        _allocate(Math.mulDiv(assets, BPS - liquidBufferBps, BPS));
        emit Deposited(msg.sender, receiver, assets, shares);
    }

    /// @dev Best-effort allocation to underweight adapters. Failures leave funds liquid rather than
    ///      bricking deposits; keepers retry via `rebalance`. Shares are always backed by base assets
    ///      already held, so skipped allocation can never create unbacked shares.
    function _allocate(uint256 budget) internal {
        if (budget == 0 || shutdown) return;
        uint256 investedNav = _targetInvestedNav();

        uint256 len = _adapters.length;
        for (uint256 i = 0; i < len && budget > 0; i++) {
            AdapterConfig storage cfg = _adapters[i];
            if (!cfg.enabled || cfg.targetBps == 0) continue;
            address adapter = cfg.adapter;

            uint256 targetAssets = Math.mulDiv(investedNav, cfg.targetBps, BPS);
            uint256 currentAssets = IStrategyAdapter(adapter).totalAssets();
            if (currentAssets >= targetAssets) continue;

            uint256 amount = Math.min(Math.min(targetAssets - currentAssets, budget), _safeMaxDeposit(adapter));
            budget -= _tryAdapterDeposit(adapter, amount);
        }
    }

    /// @dev Portion of NAV (excluding assets owed to the queue) intended to sit in adapters.
    function _targetInvestedNav() internal view returns (uint256) {
        uint256 nav = totalNav();
        uint256 reserved = _reservedAssets(nav, totalSupply());
        uint256 deployable = nav > reserved ? nav - reserved : 0;
        return Math.mulDiv(deployable, BPS - liquidBufferBps, BPS);
    }

    function _tryAdapterDeposit(address adapter, uint256 amount) internal returns (uint256 spent) {
        if (amount == 0) return 0;
        if (!_safeHealthy(adapter)) {
            emit AdapterUnhealthy(adapter);
            return 0;
        }
        uint256 balanceBefore = baseAsset.balanceOf(address(this));
        baseAsset.forceApprove(adapter, amount);
        try IStrategyAdapter(adapter).deposit(amount) returns (uint256 shares) {
            spent = balanceBefore - baseAsset.balanceOf(address(this));
            emit AdapterAllocated(adapter, spent, shares);
        } catch {
            emit AdapterDepositSkipped(adapter, amount);
        }
        baseAsset.forceApprove(adapter, 0);
    }

    // ---------------------------------------------------------------------------------------------
    // Redemptions
    // ---------------------------------------------------------------------------------------------

    /// @notice Redeem index shares for the base asset.
    /// @dev If free liquidity covers the claim the redemption settles immediately. Otherwise, when
    ///      `allowQueue` is true, shares are escrowed and a FIFO request is created.
    /// @return assetsOut Assets paid immediately (0 when queued).
    /// @return requestId Queue request id (0 when settled immediately).
    function redeem(uint256 shares, uint256 minAssetsOut, bool allowQueue, address receiver)
        external
        nonReentrant
        returns (uint256 assetsOut, uint256 requestId)
    {
        if (redemptionsPaused) revert RedemptionsPaused();
        if (receiver == address(0)) revert ZeroAddress();
        if (shares == 0 || shares < minRedeem) revert BelowMinimum();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();
        IComplianceModule module = compliance;
        if (address(module) != address(0)) module.validateRedeem(msg.sender, receiver, shares);

        _accrueFeesWithNav();

        uint256 nav = totalNav();
        uint256 supply = totalSupply();
        uint256 gross = Math.mulDiv(shares, nav, supply);
        if (gross == 0) revert ZeroAmount();
        if (gross < minAssetsOut) revert SlippageExceeded();

        uint256 balance = baseAsset.balanceOf(address(this));
        uint256 reserved = _reservedAssets(nav, supply);
        uint256 available = balance > reserved ? balance - reserved : 0;
        if (available >= gross) {
            _burn(msg.sender, shares);
            baseAsset.safeTransfer(receiver, gross);
            emit Redeemed(msg.sender, receiver, shares, gross);
            return (gross, 0);
        }

        if (!allowQueue) revert InsufficientLiquidity(gross, available);
        requestId = _enqueue(shares, minAssetsOut, receiver);
    }

    function _enqueue(uint256 shares, uint256 minAssetsOut, address receiver) internal returns (uint256 requestId) {
        if (pendingRequests >= maxQueueLength) revert QueueFull();

        ERC20._update(msg.sender, address(this), shares); // escrow without allowance
        reservedShares += shares;
        pendingRequests += 1;

        requestId = nextRequestId++;
        uint64 expiresAt = uint64(block.timestamp) + redemptionTtl;
        _requests[requestId] = RedemptionRequest({
            owner: msg.sender,
            receiver: receiver,
            shares: shares,
            minAssetsOut: minAssetsOut,
            requestedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            assetsPaid: 0,
            status: RequestStatus.PENDING
        });

        emit RedemptionRequested(requestId, msg.sender, receiver, shares, minAssetsOut, expiresAt);
    }

    /// @notice Process eligible queued redemptions in FIFO order from the vault's base balance.
    /// @dev Permissionless: it can only pay the request's recorded receiver at on-chain NAV, so broader
    ///      callability improves liveness without adding trust.
    ///
    ///      Fairness: payable requests are paid strictly in id order; when the balance cannot cover the
    ///      next payable request it is partially filled (if enabled) and processing stops, so no later
    ///      request is paid ahead of it. Requests that are not payable *right now* — expired, blocked
    ///      by compliance, or whose `minAssetsOut` floor exceeds the current claim — are skipped rather
    ///      than blocking the queue; otherwise a single request with a tight floor could freeze every
    ///      redemption behind it until expiry.
    ///
    ///      Gas: `maxRequests` bounds requests *visited* (not just filled). NAV, supply and balance are
    ///      read once and updated arithmetically after each fill, which is exact because a fill only
    ///      moves base asset out and burns escrowed shares.
    ///
    ///      Uses the actual base balance rather than `availableLiquidity()`: queued shares are already
    ///      escrowed, so paying them consumes exactly the reservation they represent. The queue thus
    ///      has priority over new instant redemptions, which are gated by `availableLiquidity()`.
    function processRedemptions(uint256 maxRequests) external nonReentrant returns (uint256 processed) {
        _accrueFeesWithNav();
        QueueCursor memory c = QueueCursor(totalNav(), totalSupply(), baseAsset.balanceOf(address(this)));

        uint64 end = nextRequestId;
        uint256 visited;
        for (uint64 id = headRequestId; id < end && visited < maxRequests && c.balance != 0; id++) {
            RedemptionRequest storage req = _requests[id];
            visited++;
            if (!_isOpen(req.status) || block.timestamp > req.expiresAt) continue;
            if (!_canPay(req.owner, req.receiver, req.shares)) {
                emit RedemptionPaymentBlocked(id, req.owner, req.receiver);
                continue;
            }
            FillResult result = _tryFill(id, req, c);
            if (result == FillResult.SKIPPED) continue;
            if (result == FillResult.BLOCKED) break; // insufficient liquidity: nobody behind it is paid
            processed++;
            if (result == FillResult.PARTIAL) break;
        }
        _advanceHead();
    }

    struct QueueCursor {
        uint256 nav;
        uint256 supply;
        uint256 balance;
    }

    enum FillResult {
        SKIPPED, // not payable right now (floor above claim); later requests may proceed
        BLOCKED, // payable but liquidity is insufficient; processing must stop
        FULL,
        PARTIAL
    }

    function _tryFill(uint64 id, RedemptionRequest storage req, QueueCursor memory c) internal returns (FillResult) {
        uint256 claim = Math.mulDiv(req.shares, c.nav, c.supply);
        if (claim == 0 || claim < req.minAssetsOut) return FillResult.SKIPPED;

        if (c.balance >= claim) {
            _fulfill(id, req, claim, req.shares, c);
            return FillResult.FULL;
        }
        if (!partialFillsEnabled) return FillResult.BLOCKED;

        // Burn the shares the balance can pay for, then pay their exact (rounded-down) value so a
        // partial fill can never pay more per share than a full fill.
        uint256 sharesToBurn = Math.mulDiv(c.balance, c.supply, c.nav);
        if (sharesToBurn >= req.shares) sharesToBurn = req.shares - 1;
        uint256 assetsOut = Math.mulDiv(sharesToBurn, c.nav, c.supply);
        if (assetsOut == 0) return FillResult.BLOCKED;
        _fulfill(id, req, assetsOut, sharesToBurn, c);
        return FillResult.PARTIAL;
    }

    function _fulfill(
        uint64 id,
        RedemptionRequest storage req,
        uint256 assetsOut,
        uint256 sharesToBurn,
        QueueCursor memory c
    ) internal {
        address receiver = req.receiver;
        uint256 sharesBefore = req.shares;
        uint256 remaining = sharesBefore - sharesToBurn;
        req.shares = remaining;
        req.assetsPaid += SafeCast.toUint128(assetsOut);
        reservedShares -= sharesToBurn;
        c.nav -= assetsOut;
        c.supply -= sharesToBurn;
        c.balance -= assetsOut;

        if (remaining == 0) {
            req.status = RequestStatus.FULFILLED;
            pendingRequests -= 1;
            emit RedemptionFilled(id, receiver, sharesToBurn, assetsOut);
        } else {
            // The floor is a per-share price: scale it to the remaining shares so the remainder can
            // still be filled at the price the requester accepted.
            req.minAssetsOut = Math.mulDiv(req.minAssetsOut, remaining, sharesBefore);
            req.status = RequestStatus.PARTIALLY_FILLED;
            emit RedemptionPartiallyFilled(id, receiver, sharesToBurn, assetsOut);
        }

        _burn(address(this), sharesToBurn);
        baseAsset.safeTransfer(receiver, assetsOut);
    }

    /// @notice Cancel a pending or partially filled request and return escrowed shares.
    /// @param recipient Eligible address to receive the shares (address(0) for the owner).
    /// @dev Revoked holders can still recover shares to an eligible recipient.
    function cancelRedemption(uint256 id, address recipient) external nonReentrant {
        RedemptionRequest storage req = _requests[id];
        if (req.owner != msg.sender) revert NotRequestOwner();
        if (recipient == address(0)) recipient = msg.sender;
        uint256 shares = _closeRequest(req, RequestStatus.CANCELLED, recipient);
        emit RedemptionCancelled(id, recipient, shares);
    }

    /// @notice Finalise an expired request and return escrowed shares to its owner. Permissionless.
    function expireRedemption(uint256 id) external nonReentrant {
        RedemptionRequest storage req = _requests[id];
        if (block.timestamp <= req.expiresAt) revert RequestNotExpired();
        address recipient = req.owner;
        uint256 shares = _closeRequest(req, RequestStatus.EXPIRED, recipient);
        emit RedemptionExpired(id, recipient, shares);
    }

    function _closeRequest(RedemptionRequest storage req, RequestStatus finalStatus, address recipient)
        internal
        returns (uint256 shares)
    {
        if (!_isOpen(req.status)) revert InvalidRequestStatus();
        shares = req.shares;
        _validateRecipient(recipient, shares);

        req.shares = 0;
        req.status = finalStatus;
        reservedShares -= shares;
        pendingRequests -= 1;

        ERC20._update(address(this), recipient, shares);
        _advanceHead();
    }

    function _advanceHead() internal {
        uint64 id = headRequestId;
        uint64 next = nextRequestId;
        while (id < next && !_isOpen(_requests[id].status)) id++;
        headRequestId = id;
    }

    function _isOpen(RequestStatus status) internal pure returns (bool) {
        return status == RequestStatus.PENDING || status == RequestStatus.PARTIALLY_FILLED;
    }

    // ---------------------------------------------------------------------------------------------
    // Liquidity and rebalancing (keeper)
    // ---------------------------------------------------------------------------------------------

    /// @notice Restore the liquidity buffer (including everything owed to the queue) or invest excess.
    /// @dev Target base balance = reserved + buffer% of the remaining NAV. Withdrawals are capped by
    ///      each adapter's `maxWithdraw` and failures are skipped, not fatal. Bounded by `maxActions`.
    function rebalance(uint256 maxActions)
        external
        nonReentrant
        onlyRole(Roles.KEEPER)
        returns (uint256 raised, uint256 allocated)
    {
        _accrueFeesWithNav();
        uint256 nav = totalNav();
        uint256 balance = baseAsset.balanceOf(address(this));
        uint256 target = _targetBalance(nav);

        if (balance < target) {
            raised = _raiseLiquidity(target - balance, maxActions);
        } else if (balance > target + Math.mulDiv(nav, weightToleranceBps, BPS)) {
            allocated = balance - target;
            _allocate(allocated);
        }
        emit Rebalanced(raised, allocated);
    }

    /// @notice Targeted withdrawal from one adapter back to the vault (e.g. to fix overweight drift).
    /// @dev Funds can only move adapter → vault. Losses are bounded by the adapter's slippage guard.
    function pullFromAdapter(address adapter, uint256 assets)
        external
        nonReentrant
        onlyRole(Roles.KEEPER)
        returns (uint256 received)
    {
        _requireKnownAdapter(adapter);
        received = _tryAdapterWithdraw(adapter, assets);
    }

    /// @notice Targeted deposit into one enabled adapter from free liquidity above the buffer target.
    /// @dev Cannot push an adapter above its target weight plus tolerance, and cannot touch liquidity
    ///      owed to the queue or required by the buffer.
    function pushToAdapter(address adapter, uint256 assets)
        external
        nonReentrant
        onlyRole(Roles.KEEPER)
        returns (uint256 spent)
    {
        AdapterConfig storage cfg = _adapters[_requireKnownAdapter(adapter)];
        if (!cfg.enabled || shutdown) revert InvalidAdapterState();

        uint256 nav = totalNav();
        uint256 balance = baseAsset.balanceOf(address(this));
        uint256 target = _targetBalance(nav);
        if (balance < target || assets > balance - target) revert InsufficientLiquidity(assets, balance);

        uint256 cap = Math.mulDiv(_targetInvestedNav(), cfg.targetBps + weightToleranceBps, BPS);
        if (IStrategyAdapter(adapter).totalAssets() + assets > cap) revert ExceedsTarget();
        spent = _tryAdapterDeposit(adapter, assets);
    }

    function _targetBalance(uint256 nav) internal view returns (uint256) {
        uint256 reserved = _reservedAssets(nav, totalSupply());
        uint256 rest = nav > reserved ? nav - reserved : 0;
        return reserved + Math.mulDiv(rest, liquidBufferBps, BPS);
    }

    /// @dev Withdraws pro-rata to current positions so restoring liquidity does not skew weights,
    ///      then makes a sequential pass for any remainder left by `maxWithdraw` caps or failures.
    ///      Finer drift correction is done by keepers through `pullFromAdapter` / `pushToAdapter`.
    ///      `maxActions` bounds the number of adapter withdrawals across both passes.
    function _raiseLiquidity(uint256 needed, uint256 maxActions) internal returns (uint256 raised) {
        uint256 len = _adapters.length;
        uint256[] memory held = new uint256[](len);
        uint256 invested;
        for (uint256 i = 0; i < len; i++) {
            if (_adapters[i].quarantined) continue;
            held[i] = IStrategyAdapter(_adapters[i].adapter).totalAssets();
            invested += held[i];
        }
        uint256 actions;
        if (invested != 0) {
            for (uint256 i = 0; i < len && actions < maxActions; i++) {
                if (held[i] == 0) continue;
                uint256 share = Math.mulDiv(needed, held[i], invested, Math.Rounding.Ceil);
                (uint256 got, bool acted) = _withdrawCapped(i, Math.min(share, needed - raised));
                raised += got;
                if (acted) actions++;
            }
        }
        for (uint256 i = 0; i < len && raised < needed && actions < maxActions; i++) {
            if (held[i] == 0) continue;
            (uint256 got, bool acted) = _withdrawCapped(i, needed - raised);
            raised += got;
            if (acted) actions++;
        }
        emit LiquidityRaised(needed, raised);
    }

    function _withdrawCapped(uint256 i, uint256 amount) internal returns (uint256 received, bool acted) {
        address adapter = _adapters[i].adapter;
        amount = Math.min(amount, _safeMaxWithdraw(adapter));
        if (amount == 0) return (0, false);
        return (_tryAdapterWithdraw(adapter, amount), true);
    }

    function _tryAdapterWithdraw(address adapter, uint256 amount) internal returns (uint256 received) {
        if (amount == 0) return 0;
        uint256 balanceBefore = baseAsset.balanceOf(address(this));
        // The adapter-reported value is ignored: the vault trusts only its own balance delta.
        try IStrategyAdapter(adapter).withdraw(amount) returns (uint256) {
            received = baseAsset.balanceOf(address(this)) - balanceBefore;
            emit AdapterLiquidityPulled(adapter, amount, received);
        } catch {
            emit AdapterWithdrawSkipped(adapter, amount);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Configuration (curator)
    // ---------------------------------------------------------------------------------------------

    /// @notice Deploy a governed adapter clone bound to this vault and an underlying position.
    /// @dev The adapter implementation must be allowlisted in {AdapterRegistry}. The new adapter is
    ///      not allocated to until it is included in {setAdapterWeights}.
    function deployAdapter(bytes32 kind, address target, uint16 slippageBps)
        external
        onlyRole(Roles.CURATOR)
        returns (address adapter)
    {
        adapter = registry.createAdapter(kind, target, slippageBps);
        configVersion += 1;
        emit AdapterDeployed(adapter, kind, target);
    }

    /// @notice Atomically set target weights. Adapters not included are disabled (weight 0).
    /// @dev Weights are basis points of invested NAV and must sum to exactly 10_000 (or be empty for
    ///      a fully liquid index).
    function setAdapterWeights(address[] calldata adapters_, uint16[] calldata weights_)
        external
        onlyRole(Roles.CURATOR)
    {
        uint256 len = adapters_.length;
        if (len != weights_.length) revert InvalidWeights();

        // Disable everything first; listed adapters are re-enabled below. Omitted adapters remain
        // valued and withdrawable, they simply receive no new allocation.
        uint256 existing = _adapters.length;
        for (uint256 i = 0; i < existing; i++) {
            _adapters[i].enabled = false;
            _adapters[i].targetBps = 0;
        }

        uint256 sum;
        for (uint256 i = 0; i < len; i++) {
            sum += weights_[i];
            _upsertAdapter(adapters_[i], weights_[i]);
        }
        if (len != 0 && sum != BPS) revert InvalidWeights();

        configVersion += 1;
        emit AdapterWeightsUpdated(configVersion, _adapters.length);
    }

    function _upsertAdapter(address adapter, uint16 bps) internal {
        if (bps == 0) revert InvalidWeights();
        _requireApprovedAdapter(adapter);

        uint256 indexPlusOne = _adapterIndexPlusOne[adapter];
        if (indexPlusOne == 0) {
            if (_adapters.length >= MAX_ADAPTERS) revert TooManyAdapters();
            _adapters.push(AdapterConfig({adapter: adapter, targetBps: bps, enabled: true, quarantined: false}));
            _adapterIndexPlusOne[adapter] = _adapters.length;
            return;
        }
        AdapterConfig storage cfg = _adapters[indexPlusOne - 1];
        if (cfg.enabled) revert InvalidWeights(); // duplicate entry in the same call
        if (cfg.quarantined) revert InvalidAdapterState();
        cfg.targetBps = bps;
        cfg.enabled = true;
    }

    function _requireApprovedAdapter(address adapter) internal view {
        if (adapter.code.length == 0) revert NotAContract();
        if (!registry.isAdapter(adapter)) revert AdapterNotApproved();
        IStrategyAdapter strategy = IStrategyAdapter(adapter);
        if (strategy.indexVault() != address(this)) revert AdapterMismatch();
        if (strategy.asset() != address(baseAsset)) revert AdapterMismatch();
        if (!strategy.isHealthy()) revert InvalidAdapterState();
    }

    function _requireKnownAdapter(address adapter) internal view returns (uint256 index) {
        uint256 indexPlusOne = _adapterIndexPlusOne[adapter];
        if (indexPlusOne == 0) revert AdapterMismatch();
        return indexPlusOne - 1;
    }

    /// @notice Remove an adapter that holds no value. Assets must be withdrawn first.
    function removeAdapter(address adapter) external onlyRole(Roles.CURATOR) {
        uint256 index = _requireKnownAdapter(adapter);
        if (IStrategyAdapter(adapter).totalAssets() != 0) revert InvalidAdapterState();

        uint256 last = _adapters.length - 1;
        if (index != last) {
            AdapterConfig memory moved = _adapters[last];
            _adapters[index] = moved;
            _adapterIndexPlusOne[moved.adapter] = index + 1;
        }
        _adapters.pop();
        delete _adapterIndexPlusOne[adapter];
        configVersion += 1;
        emit AdapterRemoved(adapter);
    }

    function setLiquidityParams(uint16 liquidBufferBps_, uint16 weightToleranceBps_) external onlyRole(Roles.CURATOR) {
        _validateLiquidity(liquidBufferBps_, weightToleranceBps_);
        liquidBufferBps = liquidBufferBps_;
        weightToleranceBps = weightToleranceBps_;
        configVersion += 1;
        emit LiquidityParamsUpdated(liquidBufferBps_, weightToleranceBps_);
    }

    function setLimits(
        uint256 minDeposit_,
        uint256 minRedeem_,
        uint64 redemptionTtl_,
        uint32 maxQueueLength_,
        bool partialFillsEnabled_
    ) external onlyRole(Roles.CURATOR) {
        _validateLimits(minDeposit_, minRedeem_, redemptionTtl_, maxQueueLength_);
        minDeposit = minDeposit_;
        minRedeem = minRedeem_;
        redemptionTtl = redemptionTtl_;
        maxQueueLength = maxQueueLength_;
        partialFillsEnabled = partialFillsEnabled_;
        configVersion += 1;
        emit LimitsUpdated(minDeposit_, minRedeem_, redemptionTtl_, maxQueueLength_, partialFillsEnabled_);
    }

    function _validateLiquidity(uint16 bufferBps, uint16 toleranceBps) internal pure {
        if (bufferBps > MAX_LIQUID_BUFFER_BPS || toleranceBps > MAX_WEIGHT_TOLERANCE_BPS) {
            revert InvalidParameter();
        }
    }

    function _validateLimits(uint256 minDeposit_, uint256 minRedeem_, uint64 ttl, uint32 queueLength) internal pure {
        if (minDeposit_ == 0 || minRedeem_ == 0) revert InvalidParameter();
        if (ttl < MIN_REDEMPTION_TTL || ttl > MAX_REDEMPTION_TTL) revert InvalidParameter();
        if (queueLength == 0 || queueLength > MAX_QUEUE_LENGTH) revert InvalidParameter();
    }

    /// @notice Update fees. Accrues outstanding fees first so new rates are not applied retroactively.
    function setFeeConfig(uint16 managementFeeBps_, uint16 performanceFeeBps_) external onlyRole(Roles.CURATOR) {
        _accrueFeesWithNav();
        _setFeeConfig(managementFeeBps_, performanceFeeBps_);
        configVersion += 1;
    }

    function setFeeRecipient(address recipient_) external onlyRole(Roles.CURATOR) {
        _accrueFeesWithNav();
        _setFeeRecipient(recipient_);
        configVersion += 1;
    }

    /// @notice Replace the compliance module. Admin-only: a module that reverts in `validateRedeem`
    ///         or `validateTransfer` can block exits, so this is not a curator power.
    function setCompliance(address module) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (module != address(0) && module.code.length == 0) revert NotAContract();
        compliance = IComplianceModule(module);
        configVersion += 1;
        emit ComplianceUpdated(module);
    }

    /// @notice Rotate the curator address and role (DEFAULT_ADMIN only).
    function setCurator(address newCurator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newCurator == address(0)) revert ZeroAddress();
        _revokeRole(Roles.CURATOR, curator);
        curator = newCurator;
        _grantRole(Roles.CURATOR, newCurator);
        configVersion += 1;
        emit CuratorUpdated(newCurator);
    }

    // ---------------------------------------------------------------------------------------------
    // Emergency controls
    // ---------------------------------------------------------------------------------------------

    /// @notice Pause new deposits. Cannot be lifted after an emergency shutdown.
    function setDepositsPaused(bool paused) external onlyRole(Roles.PAUSER) {
        if (!paused && shutdown) revert InvalidParameter();
        depositsPaused = paused;
        emit DepositsPausedUpdated(paused);
    }

    /// @notice Pause new redemption requests. Queue processing, cancellation and expiry stay open.
    function setRedemptionsPaused(bool paused) external onlyRole(Roles.PAUSER) {
        redemptionsPaused = paused;
        emit RedemptionsPausedUpdated(paused);
    }

    /// @notice Irreversible emergency stop for deposits and new allocations.
    /// @dev Exits remain possible via instant redemption and the queue; no admin path can confiscate
    ///      or redirect user assets.
    function emergencyShutdown() external onlyRole(Roles.PAUSER) {
        shutdown = true;
        depositsPaused = true;
        emit EmergencyShutdownTriggered(msg.sender);
        emit DepositsPausedUpdated(true);
    }

    /// @notice Exclude (or re-include) an adapter whose valuation reverts or is untrustworthy.
    /// @dev Without this, a single reverting `totalAssets()` would freeze every deposit and exit.
    ///      Quarantining marks the position as worth zero for NAV, so it is restricted to the admin
    ///      (expected: timelocked multisig) and forces deposits paused to prevent new depositors
    ///      buying in at the written-down NAV. Re-including restores the value to all holders.
    function setAdapterQuarantined(address adapter, bool quarantined) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AdapterConfig storage cfg = _adapters[_requireKnownAdapter(adapter)];
        cfg.quarantined = quarantined;
        if (quarantined) {
            cfg.enabled = false;
            depositsPaused = true;
            emit DepositsPausedUpdated(true);
        }
        configVersion += 1;
        emit AdapterQuarantined(adapter, quarantined);
    }

    // ---------------------------------------------------------------------------------------------
    // Share transfers and compliance
    // ---------------------------------------------------------------------------------------------

    /// @dev Transfers between holders are checked against the compliance module. Mints/burns are
    ///      validated by deposit/redeem; escrow movements bypass this hook via `ERC20._update`.
    ///      Direct transfers to the vault are rejected so shares cannot be stranded outside escrow.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (to == address(this)) revert TransferToVault();
            IComplianceModule module = compliance;
            if (address(module) != address(0)) module.validateTransfer(from, to, value);
        }
        super._update(from, to, value);
    }

    // ---------------------------------------------------------------------------------------------
    // Fee integration
    // ---------------------------------------------------------------------------------------------

    /// @notice Accrue management and performance fees by minting shares to the fee recipient.
    function accrueFees() external nonReentrant {
        _accrueFeesWithNav();
    }

    function _accrueFeesWithNav() internal {
        _accrueFees(totalNav(), totalSupply());
    }

    function _convertToShares(uint256 assets, uint256 nav, uint256 supply) internal view override returns (uint256) {
        return Math.mulDiv(assets, supply + virtualShares, nav + 1);
    }

    function _mintShares(address to, uint256 amount) internal override {
        _mint(to, amount);
    }

    function _totalSupply() internal view override returns (uint256) {
        return totalSupply();
    }

    function _totalNavForFees() internal view override returns (uint256) {
        return totalNav();
    }

    // ---------------------------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------------------------

    function _reservedAssets(uint256 nav, uint256 supply) internal view returns (uint256) {
        uint256 shares = reservedShares;
        if (shares == 0 || supply == 0) return 0;
        return Math.mulDiv(shares, nav, supply, Math.Rounding.Ceil);
    }

    function _validateRecipient(address recipient, uint256 shares) internal view {
        IComplianceModule module = compliance;
        if (address(module) != address(0)) module.validateTransfer(address(this), recipient, shares);
    }

    function _canPay(address owner, address receiver, uint256 shares) internal view returns (bool) {
        IComplianceModule module = compliance;
        if (address(module) == address(0)) return true;
        try module.validateRedeem(owner, receiver, shares) {
            return true;
        } catch {
            return false;
        }
    }

    function _safeHealthy(address adapter) internal view returns (bool) {
        try IStrategyAdapter(adapter).isHealthy() returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    function _safeMaxDeposit(address adapter) internal view returns (uint256) {
        try IStrategyAdapter(adapter).maxDeposit() returns (uint256 max) {
            return max;
        } catch {
            return 0;
        }
    }

    function _safeMaxWithdraw(address adapter) internal view returns (uint256) {
        try IStrategyAdapter(adapter).maxWithdraw() returns (uint256 max) {
            return max;
        } catch {
            return 0;
        }
    }
}
