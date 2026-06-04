// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { AccessManaged } from "@openzeppelin/contracts/access/manager/AccessManaged.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ERC7540 } from "@openzeppelin/community-contracts/token/ERC20/extensions/ERC7540.sol";

interface ICircleTokenMessengerV2Like {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;
}

/// @notice OmniETF vault built directly on OpenZeppelin Community Contracts' ERC7540 base.
/// @dev The OZ base owns ERC-20 shares, ERC-4626/7575 routing, operator checks, and async previews.
contract OmniETFOZAsyncVault is ERC7540, Ownable, AccessManaged, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant REPORTER_ROLE_ID = 1;
    uint64 public constant PAUSER_ROLE_ID = 2;

    enum RequestState {
        None,
        Pending,
        Settled,
        Claimable,
        Claimed
    }

    struct DepositRoute {
        bytes32 solanaUsdcTokenAccount;
        uint256 maxFee;
        bool configured;
    }

    struct DepositRecord {
        address controller;
        address owner;
        uint256 requestedAssets;
        uint256 claimableAssets;
        uint256 claimableShares;
        uint256 claimableManagedAssets;
        uint256 claimedAssets;
        uint256 claimedShares;
        uint256 claimedManagedAssets;
        bytes32 solanaUsdcTokenAccount;
        uint256 maxFee;
        uint256 requestId;
        RequestState state;
    }

    struct RedeemRecord {
        address controller;
        address owner;
        uint256 requestedShares;
        uint256 claimableShares;
        uint256 claimableAssets;
        uint256 claimedShares;
        uint256 claimedAssets;
        uint256 requestId;
        RequestState state;
    }

    ICircleTokenMessengerV2Like public immutable TOKEN_MESSENGER;
    uint32 public immutable DESTINATION_DOMAIN;
    bytes32 public immutable DESTINATION_CALLER;
    uint32 public immutable MIN_FINALITY_THRESHOLD;

    uint256 public totalManagedAssets;
    uint256 public reservedRedeemAssets;
    uint256 public nextDepositNonce = 1;
    uint256 public nextRedeemNonce = 1;

    mapping(bytes32 id => DepositRecord) public deposits;
    mapping(bytes32 id => RedeemRecord) public redeems;
    mapping(uint256 requestId => bytes32 id) public depositIdByRequestId;
    mapping(uint256 requestId => bytes32 id) public redeemIdByRequestId;
    mapping(bytes32 id => uint256 requestId) public depositRequestIdById;
    mapping(bytes32 id => uint256 requestId) public redeemRequestIdById;
    mapping(address controller => DepositRoute route) public depositRoutes;

    event TotalManagedAssetsReported(uint256 oldTotalAssets, uint256 newTotalAssets);
    event DepositRouteSet(
        address indexed controller, bytes32 solanaUsdcTokenAccount, uint256 maxFee
    );
    event DepositSettled(uint256 indexed requestId, bytes32 indexed depositId);
    event DepositExecuted(
        uint256 indexed requestId,
        bytes32 indexed depositId,
        uint256 claimableAssets,
        uint256 claimableShares
    );
    event RedeemPayoutFunded(
        uint256 indexed requestId,
        bytes32 indexed redeemId,
        address indexed funder,
        uint256 assetsFunded
    );
    event RedeemFulfilled(
        uint256 indexed requestId,
        bytes32 indexed redeemId,
        uint256 claimableShares,
        uint256 claimableAssets
    );

    error ZeroAddress();
    error AmountZero();
    error RecipientZero();
    error MaxFeeTooHigh();
    error RouteNotConfigured();
    error UnknownDeposit();
    error UnknownRedeem();
    error InvalidDepositState();
    error InvalidRedeemState();
    error InsufficientClaimableAssets();
    error InsufficientClaimableShares();
    error InsufficientPayoutAssets();

    constructor(
        IERC20 usdc_,
        address tokenMessenger_,
        uint32 destinationDomain_,
        bytes32 destinationCaller_,
        uint32 minFinalityThreshold_,
        address accessManager_,
        address initialOwner_
    )
        ERC20("OmniETF Share", "mETF")
        ERC7540(usdc_)
        Ownable(initialOwner_)
        AccessManaged(accessManager_)
    {
        if (
            address(usdc_) == address(0) || tokenMessenger_ == address(0)
                || accessManager_ == address(0) || initialOwner_ == address(0)
        ) {
            revert ZeroAddress();
        }
        TOKEN_MESSENGER = ICircleTokenMessengerV2Like(tokenMessenger_);
        DESTINATION_DOMAIN = destinationDomain_;
        DESTINATION_CALLER = destinationCaller_;
        MIN_FINALITY_THRESHOLD = minFinalityThreshold_;
    }

    function decimals() public pure override(ERC7540) returns (uint8) {
        return 6;
    }

    function pause() external restricted {
        _pause();
    }

    function unpause() external restricted {
        _unpause();
    }

    function setDepositRoute(bytes32 solanaUsdcTokenAccount, uint256 maxFee)
        external
        whenNotPaused
        returns (bool)
    {
        _setDepositRoute(msg.sender, solanaUsdcTokenAccount, maxFee);
        return true;
    }

    function requestDeposit(uint256 assets, bytes32 solanaUsdcTokenAccount, uint256 maxFee)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 depositId)
    {
        _setDepositRoute(msg.sender, solanaUsdcTokenAccount, maxFee);
        uint256 requestId = super.requestDeposit(assets, msg.sender, msg.sender);
        return depositIdByRequestId[requestId];
    }

    function requestDeposit(uint256 assets, address controller, address owner)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.requestDeposit(assets, controller, owner);
    }

    function requestRedeem(uint256 shares, address controller, address owner)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.requestRedeem(shares, controller, owner);
    }

    function requestRedeem(uint256 shares) external returns (bytes32 redeemId) {
        uint256 requestId = super.requestRedeem(shares, msg.sender, msg.sender);
        return redeemIdByRequestId[requestId];
    }

    function deposit(uint256 assets, address receiver, address controller)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.deposit(assets, receiver, controller);
    }

    function mint(uint256 shares, address receiver, address controller)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.mint(shares, receiver, controller);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.redeem(shares, receiver, owner);
    }

    function markDepositSettled(bytes32 depositId) external restricted {
        DepositRecord storage request = _knownDeposit(depositId);
        if (request.state != RequestState.Pending) revert InvalidDepositState();
        request.state = RequestState.Settled;
        emit DepositSettled(request.requestId, depositId);
    }

    function markDepositExecuted(bytes32 depositId, uint256 executedValueAssets)
        external
        restricted
    {
        if (executedValueAssets == 0) revert AmountZero();
        DepositRecord storage request = _knownDeposit(depositId);
        if (request.state != RequestState.Settled) revert InvalidDepositState();

        uint256 shares = _convertToShares(executedValueAssets, Math.Rounding.Floor);
        if (shares == 0) revert AmountZero();
        request.claimableAssets = request.requestedAssets;
        request.claimableShares = shares;
        request.claimableManagedAssets = executedValueAssets;
        request.state = RequestState.Claimable;
        emit DepositExecuted(request.requestId, depositId, request.requestedAssets, shares);
    }

    function finalizeDeposit(bytes32 depositId, uint256 executedValueAssets)
        external
        restricted
        returns (uint256 shares)
    {
        DepositRecord storage request = _knownDeposit(depositId);
        if (request.state == RequestState.Pending) {
            request.state = RequestState.Settled;
            emit DepositSettled(request.requestId, depositId);
        }
        if (request.state == RequestState.Settled) {
            if (executedValueAssets == 0) revert AmountZero();
            uint256 claimableShares = _convertToShares(executedValueAssets, Math.Rounding.Floor);
            if (claimableShares == 0) revert AmountZero();
            request.claimableAssets = request.requestedAssets;
            request.claimableShares = claimableShares;
            request.claimableManagedAssets = executedValueAssets;
            request.state = RequestState.Claimable;
            emit DepositExecuted(
                request.requestId, depositId, request.requestedAssets, claimableShares
            );
        }
        if (request.state != RequestState.Claimable) revert InvalidDepositState();
        uint256 assets = request.claimableAssets - request.claimedAssets;
        shares = _consumeClaimableDeposit(assets, request.controller);
        _deposit(request.controller, request.controller, assets, shares);
    }

    function fundRedeemPayout(bytes32 redeemId, uint256 assetsClaimable)
        external
        restricted
        nonReentrant
    {
        RedeemRecord storage request = _knownRedeem(redeemId);
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assetsClaimable);
        _markRedeemClaimable(redeemId, request, assetsClaimable);
        emit RedeemPayoutFunded(request.requestId, redeemId, msg.sender, assetsClaimable);
    }

    function markRedeemClaimable(bytes32 redeemId, uint256 assetsClaimable) external restricted {
        RedeemRecord storage request = _knownRedeem(redeemId);
        _markRedeemClaimable(redeemId, request, assetsClaimable);
    }

    function claimRedeem(bytes32 redeemId)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        RedeemRecord storage request = _knownRedeem(redeemId);
        _checkOperatorOrController(true, request.controller, msg.sender);
        uint256 shares = request.claimableShares - request.claimedShares;
        assets = _consumeClaimableRedeem(shares, request.controller);
        _withdraw(msg.sender, msg.sender, request.controller, assets, shares);
    }

    function reportTotalManagedAssets(uint256 newTotalManagedAssets) external restricted {
        uint256 oldTotalManagedAssets = totalManagedAssets;
        totalManagedAssets = newTotalManagedAssets;
        emit TotalManagedAssetsReported(oldTotalManagedAssets, newTotalManagedAssets);
    }

    function totalAssets() public view override returns (uint256) {
        return totalManagedAssets;
    }

    function availableRedeemPayoutAssets() public view returns (uint256) {
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        if (balance <= reservedRedeemAssets) return 0;
        return balance - reservedRedeemAssets;
    }

    function _requestDeposit(uint256 assets, address controller, address owner, uint256)
        internal
        override
        returns (uint256 requestId)
    {
        if (assets == 0) revert AmountZero();
        if (controller == address(0) || owner == address(0)) revert ZeroAddress();
        DepositRoute memory route = depositRoutes[controller];
        if (!route.configured) revert RouteNotConfigured();
        if (route.maxFee >= assets) revert MaxFeeTooHigh();

        requestId = nextDepositNonce++;
        bytes32 depositId = bytes32(requestId);
        deposits[depositId] = DepositRecord({
            controller: controller,
            owner: owner,
            requestedAssets: assets,
            claimableAssets: 0,
            claimableShares: 0,
            claimableManagedAssets: 0,
            claimedAssets: 0,
            claimedShares: 0,
            claimedManagedAssets: 0,
            solanaUsdcTokenAccount: route.solanaUsdcTokenAccount,
            maxFee: route.maxFee,
            requestId: requestId,
            state: RequestState.Pending
        });
        depositIdByRequestId[requestId] = depositId;
        depositRequestIdById[depositId] = requestId;

        super._requestDeposit(assets, controller, owner, requestId);
        IERC20(asset()).forceApprove(address(TOKEN_MESSENGER), assets);
        TOKEN_MESSENGER.depositForBurn(
            assets,
            DESTINATION_DOMAIN,
            route.solanaUsdcTokenAccount,
            asset(),
            DESTINATION_CALLER,
            route.maxFee,
            MIN_FINALITY_THRESHOLD
        );
        IERC20(asset()).forceApprove(address(TOKEN_MESSENGER), 0);
    }

    function _requestRedeem(uint256 shares, address controller, address owner, uint256)
        internal
        override
        returns (uint256 requestId)
    {
        if (shares == 0) revert AmountZero();
        if (controller == address(0) || owner == address(0)) revert ZeroAddress();
        requestId = nextRedeemNonce++;
        bytes32 redeemId = bytes32(requestId);
        redeems[redeemId] = RedeemRecord({
            controller: controller,
            owner: owner,
            requestedShares: shares,
            claimableShares: 0,
            claimableAssets: 0,
            claimedShares: 0,
            claimedAssets: 0,
            requestId: requestId,
            state: RequestState.Pending
        });
        redeemIdByRequestId[requestId] = redeemId;
        redeemRequestIdById[redeemId] = requestId;
        super._requestRedeem(shares, controller, owner, requestId);
    }

    function _pendingDepositRequest(uint256 requestId, address controller)
        internal
        view
        override
        returns (uint256)
    {
        DepositRecord storage request = deposits[depositIdByRequestId[requestId]];
        if (request.controller != controller) return 0;
        if (request.state == RequestState.Pending || request.state == RequestState.Settled) {
            return request.requestedAssets;
        }
        return 0;
    }

    function _claimableDepositRequest(uint256 requestId, address controller)
        internal
        view
        override
        returns (uint256)
    {
        DepositRecord storage request = deposits[depositIdByRequestId[requestId]];
        if (request.controller != controller || request.state != RequestState.Claimable) return 0;
        return request.claimableAssets - request.claimedAssets;
    }

    function _pendingRedeemRequest(uint256 requestId, address controller)
        internal
        view
        override
        returns (uint256)
    {
        RedeemRecord storage request = redeems[redeemIdByRequestId[requestId]];
        if (request.controller != controller || request.state != RequestState.Pending) return 0;
        return request.requestedShares;
    }

    function _claimableRedeemRequest(uint256 requestId, address controller)
        internal
        view
        override
        returns (uint256)
    {
        RedeemRecord storage request = redeems[redeemIdByRequestId[requestId]];
        if (request.controller != controller || request.state != RequestState.Claimable) return 0;
        return request.claimableShares - request.claimedShares;
    }

    function _consumeClaimableDeposit(uint256 assets, address controller)
        internal
        override
        returns (uint256 shares)
    {
        if (assets == 0) revert AmountZero();
        uint256 remainingAssets = assets;
        for (
            uint256 requestId = 1;
            requestId < nextDepositNonce && remainingAssets != 0;
            ++requestId
        ) {
            DepositRecord storage request = deposits[depositIdByRequestId[requestId]];
            if (request.controller != controller || request.state != RequestState.Claimable) {
                continue;
            }
            uint256 availableAssets = request.claimableAssets - request.claimedAssets;
            uint256 availableShares = request.claimableShares - request.claimedShares;
            uint256 availableManagedAssets =
                request.claimableManagedAssets - request.claimedManagedAssets;
            uint256 usedAssets = Math.min(availableAssets, remainingAssets);
            uint256 usedShares = usedAssets == availableAssets
                ? availableShares
                : Math.mulDiv(usedAssets, availableShares, availableAssets, Math.Rounding.Floor);
            uint256 usedManagedAssets = usedAssets == availableAssets
                ? availableManagedAssets
                : Math.mulDiv(
                    usedAssets, availableManagedAssets, availableAssets, Math.Rounding.Floor
                );
            request.claimedAssets += usedAssets;
            request.claimedShares += usedShares;
            request.claimedManagedAssets += usedManagedAssets;
            remainingAssets -= usedAssets;
            shares += usedShares;
            totalManagedAssets += usedManagedAssets;
            if (request.claimedAssets == request.claimableAssets) {
                request.state = RequestState.Claimed;
            }
        }
        if (remainingAssets != 0) revert InsufficientClaimableAssets();
    }

    function _consumeClaimableMint(uint256 shares, address controller)
        internal
        override
        returns (uint256 assets)
    {
        if (shares == 0) revert AmountZero();
        uint256 remainingShares = shares;
        for (
            uint256 requestId = 1;
            requestId < nextDepositNonce && remainingShares != 0;
            ++requestId
        ) {
            DepositRecord storage request = deposits[depositIdByRequestId[requestId]];
            if (request.controller != controller || request.state != RequestState.Claimable) {
                continue;
            }
            uint256 availableAssets = request.claimableAssets - request.claimedAssets;
            uint256 availableShares = request.claimableShares - request.claimedShares;
            uint256 availableManagedAssets =
                request.claimableManagedAssets - request.claimedManagedAssets;
            uint256 usedShares = Math.min(availableShares, remainingShares);
            uint256 usedAssets = usedShares == availableShares
                ? availableAssets
                : Math.mulDiv(usedShares, availableAssets, availableShares, Math.Rounding.Ceil);
            uint256 usedManagedAssets = usedShares == availableShares
                ? availableManagedAssets
                : Math.mulDiv(
                    usedShares, availableManagedAssets, availableShares, Math.Rounding.Floor
                );
            request.claimedAssets += usedAssets;
            request.claimedShares += usedShares;
            request.claimedManagedAssets += usedManagedAssets;
            remainingShares -= usedShares;
            assets += usedAssets;
            totalManagedAssets += usedManagedAssets;
            if (request.claimedShares == request.claimableShares) {
                request.state = RequestState.Claimed;
            }
        }
        if (remainingShares != 0) revert InsufficientClaimableShares();
    }

    function _consumeClaimableWithdraw(uint256 assets, address controller)
        internal
        override
        returns (uint256 shares)
    {
        if (assets == 0) revert AmountZero();
        uint256 remainingAssets = assets;
        for (
            uint256 requestId = 1;
            requestId < nextRedeemNonce && remainingAssets != 0;
            ++requestId
        ) {
            RedeemRecord storage request = redeems[redeemIdByRequestId[requestId]];
            if (request.controller != controller || request.state != RequestState.Claimable) {
                continue;
            }
            uint256 availableAssets = request.claimableAssets - request.claimedAssets;
            uint256 availableShares = request.claimableShares - request.claimedShares;
            uint256 usedAssets = Math.min(availableAssets, remainingAssets);
            uint256 usedShares = usedAssets == availableAssets
                ? availableShares
                : Math.mulDiv(usedAssets, availableShares, availableAssets, Math.Rounding.Ceil);
            request.claimedAssets += usedAssets;
            request.claimedShares += usedShares;
            remainingAssets -= usedAssets;
            shares += usedShares;
            reservedRedeemAssets -= usedAssets;
            if (request.claimedAssets == request.claimableAssets) {
                request.state = RequestState.Claimed;
            }
        }
        if (remainingAssets != 0) revert InsufficientClaimableAssets();
        _decreaseManagedAssets(assets);
    }

    function _consumeClaimableRedeem(uint256 shares, address controller)
        internal
        override
        returns (uint256 assets)
    {
        if (shares == 0) revert AmountZero();
        uint256 remainingShares = shares;
        for (
            uint256 requestId = 1;
            requestId < nextRedeemNonce && remainingShares != 0;
            ++requestId
        ) {
            RedeemRecord storage request = redeems[redeemIdByRequestId[requestId]];
            if (request.controller != controller || request.state != RequestState.Claimable) {
                continue;
            }
            uint256 availableAssets = request.claimableAssets - request.claimedAssets;
            uint256 availableShares = request.claimableShares - request.claimedShares;
            uint256 usedShares = Math.min(availableShares, remainingShares);
            uint256 usedAssets = usedShares == availableShares
                ? availableAssets
                : Math.mulDiv(usedShares, availableAssets, availableShares, Math.Rounding.Floor);
            request.claimedAssets += usedAssets;
            request.claimedShares += usedShares;
            remainingShares -= usedShares;
            assets += usedAssets;
            reservedRedeemAssets -= usedAssets;
            if (request.claimedShares == request.claimableShares) {
                request.state = RequestState.Claimed;
            }
        }
        if (remainingShares != 0) revert InsufficientClaimableShares();
        _decreaseManagedAssets(assets);
    }

    function _asyncMaxDeposit(address owner) internal view override returns (uint256 assets) {
        for (uint256 requestId = 1; requestId < nextDepositNonce; ++requestId) {
            DepositRecord storage request = deposits[depositIdByRequestId[requestId]];
            if (request.controller == owner && request.state == RequestState.Claimable) {
                assets += request.claimableAssets - request.claimedAssets;
            }
        }
    }

    function _asyncMaxMint(address owner) internal view override returns (uint256 shares) {
        for (uint256 requestId = 1; requestId < nextDepositNonce; ++requestId) {
            DepositRecord storage request = deposits[depositIdByRequestId[requestId]];
            if (request.controller == owner && request.state == RequestState.Claimable) {
                shares += request.claimableShares - request.claimedShares;
            }
        }
    }

    function _asyncMaxWithdraw(address owner) internal view override returns (uint256 assets) {
        for (uint256 requestId = 1; requestId < nextRedeemNonce; ++requestId) {
            RedeemRecord storage request = redeems[redeemIdByRequestId[requestId]];
            if (request.controller == owner && request.state == RequestState.Claimable) {
                assets += request.claimableAssets - request.claimedAssets;
            }
        }
    }

    function _asyncMaxRedeem(address owner) internal view override returns (uint256 shares) {
        for (uint256 requestId = 1; requestId < nextRedeemNonce; ++requestId) {
            RedeemRecord storage request = redeems[redeemIdByRequestId[requestId]];
            if (request.controller == owner && request.state == RequestState.Claimable) {
                shares += request.claimableShares - request.claimedShares;
            }
        }
    }

    function _isDepositAsync() internal pure override returns (bool) {
        return true;
    }

    function _isRedeemAsync() internal pure override returns (bool) {
        return true;
    }

    function _markRedeemClaimable(
        bytes32 redeemId,
        RedeemRecord storage request,
        uint256 assetsClaimable
    ) private {
        if (assetsClaimable == 0) revert AmountZero();
        if (request.state != RequestState.Pending) revert InvalidRedeemState();
        if (availableRedeemPayoutAssets() < assetsClaimable) revert InsufficientPayoutAssets();
        request.claimableShares = request.requestedShares;
        request.claimableAssets = assetsClaimable;
        reservedRedeemAssets += assetsClaimable;
        request.state = RequestState.Claimable;
        emit RedeemFulfilled(request.requestId, redeemId, request.claimableShares, assetsClaimable);
    }

    function _knownDeposit(bytes32 depositId) private view returns (DepositRecord storage request) {
        request = deposits[depositId];
        if (request.controller == address(0)) revert UnknownDeposit();
    }

    function _knownRedeem(bytes32 redeemId) private view returns (RedeemRecord storage request) {
        request = redeems[redeemId];
        if (request.controller == address(0)) revert UnknownRedeem();
    }

    function _setDepositRoute(address controller, bytes32 solanaUsdcTokenAccount, uint256 maxFee)
        private
    {
        if (controller == address(0)) revert ZeroAddress();
        if (solanaUsdcTokenAccount == bytes32(0)) revert RecipientZero();
        depositRoutes[controller] = DepositRoute({
            solanaUsdcTokenAccount: solanaUsdcTokenAccount, maxFee: maxFee, configured: true
        });
        emit DepositRouteSet(controller, solanaUsdcTokenAccount, maxFee);
    }

    function _decreaseManagedAssets(uint256 assets) private {
        totalManagedAssets = totalManagedAssets >= assets ? totalManagedAssets - assets : 0;
    }
}
