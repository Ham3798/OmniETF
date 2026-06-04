// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    IERC7540,
    IERC7540Deposit,
    IERC7540Operator,
    IERC7540Redeem
} from "forge-std/interfaces/IERC7540.sol";
import { IERC165 } from "forge-std/interfaces/IERC165.sol";
import { IERC7575 } from "forge-std/interfaces/IERC7575.sol";

interface ICircleTokenMessengerV2 {
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

/// @notice ERC-7540 async vault that issues mETF shares after cross-chain execution is claimable.
/// @dev OpenZeppelin provides the ERC-20 share token, ownership, pause, reentrancy, ERC-165, and safe token calls.
contract OmniETFAsyncVault is ERC20, Ownable, AccessControl, Pausable, ReentrancyGuard, IERC7540 {
    using SafeERC20 for IERC20;

    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum DepositState {
        None,
        Pending,
        Settled,
        Claimable,
        Claimed
    }

    enum RedeemState {
        None,
        Pending,
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
        uint256 claimedAssets;
        bytes32 solanaUsdcTokenAccount;
        uint256 maxFee;
        uint256 requestId;
        DepositState state;
    }

    struct RedeemRecord {
        address controller;
        address owner;
        uint256 sharesEscrowed;
        uint256 assetsClaimable;
        uint256 assetsClaimed;
        uint256 sharesClaimed;
        uint256 requestId;
        RedeemState state;
    }

    address public immutable USDC;
    ICircleTokenMessengerV2 public immutable TOKEN_MESSENGER;
    uint32 public immutable DESTINATION_DOMAIN;
    bytes32 public immutable DESTINATION_CALLER;
    uint32 public immutable MIN_FINALITY_THRESHOLD;

    address public reporter;
    uint256 public totalManagedAssets;
    uint256 public reservedRedeemAssets;
    uint256 public nextDepositNonce = 1;
    uint256 public nextRedeemNonce = 1;

    mapping(bytes32 => DepositRecord) public deposits;
    mapping(bytes32 => RedeemRecord) public redeems;
    mapping(uint256 => bytes32) public depositIdByRequestId;
    mapping(uint256 => bytes32) public redeemIdByRequestId;
    mapping(bytes32 => uint256) public depositRequestIdById;
    mapping(bytes32 => uint256) public redeemRequestIdById;
    mapping(address controller => DepositRoute route) public depositRoutes;
    mapping(address controller => mapping(address operator => bool approved)) private _operators;

    event ReporterUpdated(address indexed oldReporter, address indexed newReporter);
    event TotalManagedAssetsReported(uint256 oldTotalAssets, uint256 newTotalAssets);
    event DepositRouteSet(
        address indexed controller, bytes32 solanaUsdcTokenAccount, uint256 maxFee
    );
    event DepositSettled(uint256 indexed requestId, bytes32 indexed depositId);
    event DepositExecuted(
        uint256 indexed requestId, bytes32 indexed depositId, uint256 claimableAssets
    );
    event RedeemClaimable(
        uint256 indexed requestId,
        bytes32 indexed redeemId,
        address indexed controller,
        uint256 assetsClaimable
    );
    event RedeemPayoutFunded(
        uint256 indexed requestId,
        bytes32 indexed redeemId,
        address indexed funder,
        uint256 assetsFunded
    );

    error ZeroAddress();
    error AmountZero();
    error RecipientZero();
    error MaxFeeTooHigh();
    error RouteNotConfigured();
    error NotReporter();
    error UnknownDeposit();
    error UnknownRedeem();
    error InvalidDepositState();
    error InvalidRedeemState();
    error NotAuthorized();
    error InsufficientClaimableAssets();
    error InsufficientClaimableShares();
    error InsufficientPayoutAssets();
    error SharesZero();
    error AssetsZero();
    error AsyncPreviewUnavailable();

    constructor(
        address usdc_,
        address tokenMessenger_,
        uint32 destinationDomain_,
        bytes32 destinationCaller_,
        uint32 minFinalityThreshold_,
        address reporter_
    ) ERC20("OmniETF Share", "mETF") Ownable(reporter_) {
        if (usdc_ == address(0) || tokenMessenger_ == address(0) || reporter_ == address(0)) {
            revert ZeroAddress();
        }

        USDC = usdc_;
        TOKEN_MESSENGER = ICircleTokenMessengerV2(tokenMessenger_);
        DESTINATION_DOMAIN = destinationDomain_;
        DESTINATION_CALLER = destinationCaller_;
        MIN_FINALITY_THRESHOLD = minFinalityThreshold_;
        reporter = reporter_;
        _grantRole(DEFAULT_ADMIN_ROLE, reporter_);
        _grantRole(REPORTER_ROLE, reporter_);
        _grantRole(PAUSER_ROLE, reporter_);
    }

    modifier onlyReporter() {
        _onlyReporter();
        _;
    }

    function _onlyReporter() private view {
        if (!hasRole(REPORTER_ROLE, msg.sender)) revert NotReporter();
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function setDepositRoute(bytes32 solanaUsdcTokenAccount, uint256 maxFee)
        external
        whenNotPaused
        returns (bool)
    {
        _setDepositRoute(solanaUsdcTokenAccount, maxFee);
        return true;
    }

    function setReporter(address newReporter) external onlyOwner {
        if (newReporter == address(0)) revert ZeroAddress();
        address oldReporter = reporter;
        _revokeRole(REPORTER_ROLE, oldReporter);
        _revokeRole(PAUSER_ROLE, oldReporter);
        _grantRole(REPORTER_ROLE, newReporter);
        _grantRole(PAUSER_ROLE, newReporter);
        emit ReporterUpdated(reporter, newReporter);
        reporter = newReporter;
    }

    function setOperator(address operator, bool approved) external returns (bool) {
        if (operator == address(0)) revert ZeroAddress();
        _operators[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    function isOperator(address controller, address operator) public view returns (bool status) {
        return _operators[controller][operator];
    }

    /// @notice Backward-compatible helper that configures the caller route and submits a standard deposit request.
    function requestDeposit(uint256 assets, bytes32 solanaUsdcTokenAccount, uint256 maxFee)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 depositId)
    {
        _setDepositRoute(solanaUsdcTokenAccount, maxFee);
        uint256 requestId = _requestDeposit(assets, msg.sender, msg.sender);
        depositId = depositIdByRequestId[requestId];
    }

    /// @inheritdoc IERC7540Deposit
    function requestDeposit(uint256 assets, address controller, address owner)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 requestId)
    {
        if (msg.sender != owner && !isOperator(owner, msg.sender)) revert NotAuthorized();
        requestId = _requestDeposit(assets, controller, owner);
    }

    function _requestDeposit(uint256 assets, address controller, address owner)
        private
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
            claimedAssets: 0,
            solanaUsdcTokenAccount: route.solanaUsdcTokenAccount,
            maxFee: route.maxFee,
            requestId: requestId,
            state: DepositState.Pending
        });
        depositIdByRequestId[requestId] = depositId;
        depositRequestIdById[depositId] = requestId;

        IERC20(USDC).safeTransferFrom(owner, address(this), assets);
        IERC20(USDC).forceApprove(address(TOKEN_MESSENGER), assets);
        TOKEN_MESSENGER.depositForBurn(
            assets,
            DESTINATION_DOMAIN,
            route.solanaUsdcTokenAccount,
            USDC,
            DESTINATION_CALLER,
            route.maxFee,
            MIN_FINALITY_THRESHOLD
        );
        IERC20(USDC).forceApprove(address(TOKEN_MESSENGER), 0);

        emit DepositRequest(controller, owner, requestId, msg.sender, assets);
    }

    function markDepositSettled(bytes32 depositId) external onlyReporter {
        DepositRecord storage request = _knownDeposit(depositId);
        if (request.state != DepositState.Pending) revert InvalidDepositState();

        request.state = DepositState.Settled;
        emit DepositSettled(request.requestId, depositId);
    }

    function markDepositExecuted(bytes32 depositId, uint256 claimableAssets) external onlyReporter {
        if (claimableAssets == 0) revert AmountZero();
        DepositRecord storage request = _knownDeposit(depositId);
        if (request.state != DepositState.Settled) revert InvalidDepositState();

        request.claimableAssets = claimableAssets;
        request.state = DepositState.Claimable;
        emit DepositExecuted(request.requestId, depositId, claimableAssets);
    }

    /// @notice Backward-compatible reporter shortcut that moves a request to claimable and immediately claims to the controller.
    function finalizeDeposit(bytes32 depositId, uint256 claimableAssets)
        external
        onlyReporter
        returns (uint256 shares)
    {
        DepositRecord storage request = _knownDeposit(depositId);
        if (request.state == DepositState.Pending) {
            request.state = DepositState.Settled;
            emit DepositSettled(request.requestId, depositId);
        }
        if (request.state == DepositState.Settled) {
            if (claimableAssets == 0) revert AmountZero();
            request.claimableAssets = claimableAssets;
            request.state = DepositState.Claimable;
            emit DepositExecuted(request.requestId, depositId, claimableAssets);
        }
        if (request.state != DepositState.Claimable) revert InvalidDepositState();

        shares = _claimDeposit(request.controller, request.controller, request.claimableAssets);
    }

    /// @inheritdoc IERC7540Deposit
    function deposit(uint256 assets, address receiver, address controller)
        public
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        _requireController(controller);
        shares = _claimDeposit(controller, receiver, assets);
    }

    /// @inheritdoc IERC7575
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        shares = deposit(assets, receiver, msg.sender);
    }

    /// @inheritdoc IERC7540Deposit
    function mint(uint256 shares, address receiver, address controller)
        public
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        _requireController(controller);
        assets = _previewMint(shares);
        if (assets == 0) revert AssetsZero();
        _claimDepositForShares(controller, receiver, assets, shares);
    }

    /// @inheritdoc IERC7575
    function mint(uint256 shares, address receiver) external returns (uint256 assets) {
        assets = mint(shares, receiver, msg.sender);
    }

    function _claimDeposit(address controller, address receiver, uint256 assets)
        private
        returns (uint256 shares)
    {
        if (assets == 0) revert AmountZero();
        if (receiver == address(0)) revert RecipientZero();

        shares = _previewDeposit(assets);
        if (shares == 0) revert SharesZero();

        _consumeClaimableDepositAssets(controller, assets);
        totalManagedAssets += assets;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function _claimDepositForShares(
        address controller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) private {
        if (shares == 0) revert AmountZero();
        if (receiver == address(0)) revert RecipientZero();

        _consumeClaimableDepositAssets(controller, assets);
        totalManagedAssets += assets;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function _consumeClaimableDepositAssets(address controller, uint256 assets) private {
        uint256 remaining = assets;
        for (uint256 requestId = 1; requestId < nextDepositNonce && remaining != 0; ++requestId) {
            bytes32 depositId = depositIdByRequestId[requestId];
            DepositRecord storage request = deposits[depositId];
            if (request.controller != controller || request.state != DepositState.Claimable) {
                continue;
            }

            uint256 available = request.claimableAssets - request.claimedAssets;
            uint256 used = Math.min(available, remaining);
            request.claimedAssets += used;
            remaining -= used;

            if (request.claimedAssets == request.claimableAssets) {
                request.state = DepositState.Claimed;
            }
        }

        if (remaining != 0) revert InsufficientClaimableAssets();
    }

    /// @notice Backward-compatible helper for owner-controlled redeem requests.
    function requestRedeem(uint256 shares) external returns (bytes32 redeemId) {
        uint256 requestId = requestRedeem(shares, msg.sender, msg.sender);
        redeemId = redeemIdByRequestId[requestId];
    }

    /// @inheritdoc IERC7540Redeem
    function requestRedeem(uint256 shares, address controller, address owner)
        public
        whenNotPaused
        nonReentrant
        returns (uint256 requestId)
    {
        if (shares == 0) revert AmountZero();
        if (controller == address(0) || owner == address(0)) revert ZeroAddress();
        if (msg.sender != owner && !isOperator(owner, msg.sender)) {
            _spendAllowance(owner, msg.sender, shares);
        }

        requestId = nextRedeemNonce++;
        bytes32 redeemId = bytes32(requestId);

        _transfer(owner, address(this), shares);
        redeems[redeemId] = RedeemRecord({
            controller: controller,
            owner: owner,
            sharesEscrowed: shares,
            assetsClaimable: 0,
            assetsClaimed: 0,
            sharesClaimed: 0,
            requestId: requestId,
            state: RedeemState.Pending
        });
        redeemIdByRequestId[requestId] = redeemId;
        redeemRequestIdById[redeemId] = requestId;

        emit RedeemRequest(controller, owner, requestId, msg.sender, shares);
    }

    function markRedeemClaimable(bytes32 redeemId) external onlyReporter {
        RedeemRecord storage request = _knownRedeem(redeemId);
        _markRedeemClaimable(redeemId, request, _previewRedeem(request.sharesEscrowed));
    }

    function markRedeemClaimable(bytes32 redeemId, uint256 assetsClaimable) external onlyReporter {
        RedeemRecord storage request = _knownRedeem(redeemId);
        _markRedeemClaimable(redeemId, request, assetsClaimable);
    }

    /// @notice Funds a redeem request with Base-side USDC and marks it claimable.
    /// @dev In production this is called after the reverse CCTP leg has delivered USDC to the reporter/settlement account.
    function fundRedeemPayout(bytes32 redeemId, uint256 assetsClaimable)
        external
        onlyReporter
        nonReentrant
    {
        RedeemRecord storage request = _knownRedeem(redeemId);
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), assetsClaimable);
        _markRedeemClaimable(redeemId, request, assetsClaimable);
        emit RedeemPayoutFunded(request.requestId, redeemId, msg.sender, assetsClaimable);
    }

    function _markRedeemClaimable(
        bytes32 redeemId,
        RedeemRecord storage request,
        uint256 assetsClaimable
    ) private {
        if (assetsClaimable == 0) revert AmountZero();
        if (request.state != RedeemState.Pending) revert InvalidRedeemState();
        if (availableRedeemPayoutAssets() < assetsClaimable) revert InsufficientPayoutAssets();

        request.assetsClaimable = assetsClaimable;
        reservedRedeemAssets += assetsClaimable;
        request.state = RedeemState.Claimable;
        emit RedeemClaimable(request.requestId, redeemId, request.controller, assetsClaimable);
    }

    function claimRedeem(bytes32 redeemId)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 assetsClaimed)
    {
        RedeemRecord storage request = _knownRedeem(redeemId);
        _requireController(request.controller);
        assetsClaimed = _claimRedeemRecord(request, msg.sender);
    }

    /// @inheritdoc IERC7575
    function withdraw(uint256 assets, address receiver, address owner)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        _requireController(owner);
        shares = _claimWithdraw(owner, receiver, assets);
        if (shares == 0) revert SharesZero();
    }

    /// @inheritdoc IERC7575
    function redeem(uint256 shares, address receiver, address owner)
        public
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        _requireController(owner);
        assets = _claimRedeem(owner, receiver, shares);
        if (assets == 0) revert AssetsZero();
    }

    function _claimRedeem(address controller, address receiver, uint256 shares)
        private
        returns (uint256 assetsPaid)
    {
        if (shares == 0) revert AmountZero();
        if (receiver == address(0)) revert RecipientZero();

        uint256 remainingShares = shares;
        for (
            uint256 requestId = 1;
            requestId < nextRedeemNonce && remainingShares != 0;
            ++requestId
        ) {
            bytes32 redeemId = redeemIdByRequestId[requestId];
            RedeemRecord storage request = redeems[redeemId];
            if (request.controller != controller || request.state != RedeemState.Claimable) {
                continue;
            }

            uint256 availableShares = request.sharesEscrowed - request.sharesClaimed;
            uint256 usedShares = Math.min(availableShares, remainingShares);
            uint256 availableAssets = request.assetsClaimable - request.assetsClaimed;
            uint256 usedAssets = usedShares == availableShares
                ? availableAssets
                : Math.min(
                    availableAssets,
                    Math.mulDiv(request.assetsClaimable, usedShares, request.sharesEscrowed)
                );

            request.sharesClaimed += usedShares;
            request.assetsClaimed += usedAssets;
            remainingShares -= usedShares;
            assetsPaid += usedAssets;

            if (request.sharesClaimed == request.sharesEscrowed) {
                request.state = RedeemState.Claimed;
            }
        }

        if (remainingShares != 0) revert InsufficientClaimableShares();
        _completeRedeem(receiver, controller, shares, assetsPaid);
    }

    function _claimWithdraw(address controller, address receiver, uint256 assets)
        private
        returns (uint256 sharesBurned)
    {
        if (assets == 0) revert AmountZero();
        if (receiver == address(0)) revert RecipientZero();

        uint256 remainingAssets = assets;
        for (
            uint256 requestId = 1;
            requestId < nextRedeemNonce && remainingAssets != 0;
            ++requestId
        ) {
            bytes32 redeemId = redeemIdByRequestId[requestId];
            RedeemRecord storage request = redeems[redeemId];
            if (request.controller != controller || request.state != RedeemState.Claimable) {
                continue;
            }

            uint256 availableAssets = request.assetsClaimable - request.assetsClaimed;
            uint256 usedAssets = Math.min(availableAssets, remainingAssets);
            uint256 usedShares = Math.mulDiv(
                usedAssets, request.sharesEscrowed, request.assetsClaimable, Math.Rounding.Ceil
            );

            request.assetsClaimed += usedAssets;
            request.sharesClaimed += usedShares;
            remainingAssets -= usedAssets;
            sharesBurned += usedShares;

            if (
                request.sharesClaimed >= request.sharesEscrowed
                    || request.assetsClaimed == request.assetsClaimable
            ) {
                request.sharesClaimed = request.sharesEscrowed;
                request.assetsClaimed = request.assetsClaimable;
                request.state = RedeemState.Claimed;
            }
        }

        if (remainingAssets != 0) revert InsufficientClaimableAssets();
        _completeRedeem(receiver, controller, sharesBurned, assets);
    }

    function _claimRedeemRecord(RedeemRecord storage request, address receiver)
        private
        returns (uint256 assetsPaid)
    {
        if (request.state != RedeemState.Claimable) revert InvalidRedeemState();

        uint256 shares = request.sharesEscrowed - request.sharesClaimed;
        if (shares == 0) revert AmountZero();

        assetsPaid = Math.mulDiv(request.assetsClaimable, shares, request.sharesEscrowed);
        request.assetsClaimed = request.assetsClaimable;
        request.sharesClaimed = request.sharesEscrowed;
        request.state = RedeemState.Claimed;
        _completeRedeem(receiver, request.controller, shares, assetsPaid);
    }

    function _completeRedeem(
        address receiver,
        address controller,
        uint256 shares,
        uint256 assetsPaid
    ) private {
        if (totalManagedAssets >= assetsPaid) {
            totalManagedAssets -= assetsPaid;
        } else {
            totalManagedAssets = 0;
        }
        reservedRedeemAssets -= assetsPaid;
        _burn(address(this), shares);
        IERC20(USDC).safeTransfer(receiver, assetsPaid);
        emit Withdraw(msg.sender, receiver, controller, assetsPaid, shares);
    }

    function pendingDepositRequest(uint256 requestId, address controller)
        external
        view
        returns (uint256 pendingAssets)
    {
        DepositRecord storage request = deposits[depositIdByRequestId[requestId]];
        if (request.controller != controller) return 0;
        if (request.state == DepositState.Pending || request.state == DepositState.Settled) {
            return request.requestedAssets;
        }
        return 0;
    }

    function claimableDepositRequest(uint256 requestId, address controller)
        external
        view
        returns (uint256 claimableAssets)
    {
        DepositRecord storage request = deposits[depositIdByRequestId[requestId]];
        if (request.controller != controller || request.state != DepositState.Claimable) return 0;
        return request.claimableAssets - request.claimedAssets;
    }

    function pendingRedeemRequest(uint256 requestId, address controller)
        external
        view
        returns (uint256 pendingShares)
    {
        RedeemRecord storage request = redeems[redeemIdByRequestId[requestId]];
        if (request.controller != controller || request.state != RedeemState.Pending) return 0;
        return request.sharesEscrowed;
    }

    function claimableRedeemRequest(uint256 requestId, address controller)
        external
        view
        returns (uint256 claimableShares)
    {
        RedeemRecord storage request = redeems[redeemIdByRequestId[requestId]];
        if (request.controller != controller || request.state != RedeemState.Claimable) return 0;
        return request.sharesEscrowed - request.sharesClaimed;
    }

    function asset() external view returns (address assetTokenAddress) {
        return USDC;
    }

    function share() external view returns (address shareTokenAddress) {
        return address(this);
    }

    function totalAssets() public view returns (uint256) {
        return totalManagedAssets;
    }

    function availableRedeemPayoutAssets() public view returns (uint256 assets) {
        uint256 balance = IERC20(USDC).balanceOf(address(this));
        if (balance <= reservedRedeemAssets) return 0;
        return balance - reservedRedeemAssets;
    }

    function convertToShares(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalSupply();
        if (supply == 0 || totalManagedAssets == 0) return assets;
        return Math.mulDiv(assets, supply, totalManagedAssets);
    }

    function convertToAssets(uint256 shares) public view returns (uint256 assets) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return Math.mulDiv(shares, totalManagedAssets, supply);
    }

    function maxDeposit(address controller) external view returns (uint256 maxAssets) {
        return _claimableDepositBalance(controller);
    }

    function previewDeposit(uint256) public pure returns (uint256) {
        revert AsyncPreviewUnavailable();
    }

    function maxMint(address controller) external view returns (uint256 maxShares) {
        return _previewDeposit(_claimableDepositBalance(controller));
    }

    function previewMint(uint256) public pure returns (uint256) {
        revert AsyncPreviewUnavailable();
    }

    function maxWithdraw(address controller) external view returns (uint256 maxAssets) {
        return _previewRedeem(_claimableRedeemBalance(controller));
    }

    function previewWithdraw(uint256) public pure returns (uint256) {
        revert AsyncPreviewUnavailable();
    }

    function maxRedeem(address controller) external view returns (uint256 maxShares) {
        return _claimableRedeemBalance(controller);
    }

    function previewRedeem(uint256) public pure returns (uint256) {
        revert AsyncPreviewUnavailable();
    }

    function nav() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1_000_000;
        return Math.mulDiv(totalManagedAssets, 1_000_000, supply);
    }

    function reportTotalManagedAssets(uint256 newTotalManagedAssets) external onlyReporter {
        uint256 oldTotalManagedAssets = totalManagedAssets;
        totalManagedAssets = newTotalManagedAssets;
        emit TotalManagedAssetsReported(oldTotalManagedAssets, newTotalManagedAssets);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC7540).interfaceId
            || interfaceId == type(IERC7540Deposit).interfaceId
            || interfaceId == type(IERC7540Redeem).interfaceId
            || interfaceId == type(IERC7540Operator).interfaceId
            || interfaceId == type(IERC7575).interfaceId || super.supportsInterface(interfaceId);
    }

    function _setDepositRoute(bytes32 solanaUsdcTokenAccount, uint256 maxFee) private {
        if (solanaUsdcTokenAccount == bytes32(0)) revert RecipientZero();
        depositRoutes[msg.sender] = DepositRoute({
            solanaUsdcTokenAccount: solanaUsdcTokenAccount, maxFee: maxFee, configured: true
        });
        emit DepositRouteSet(msg.sender, solanaUsdcTokenAccount, maxFee);
    }

    function _requireController(address controller) private view {
        if (controller == address(0)) revert ZeroAddress();
        if (msg.sender != controller && !isOperator(controller, msg.sender)) {
            revert NotAuthorized();
        }
    }

    function _knownDeposit(bytes32 depositId) private view returns (DepositRecord storage request) {
        request = deposits[depositId];
        if (request.controller == address(0)) revert UnknownDeposit();
    }

    function _knownRedeem(bytes32 redeemId) private view returns (RedeemRecord storage request) {
        request = redeems[redeemId];
        if (request.controller == address(0)) revert UnknownRedeem();
    }

    function _claimableDepositBalance(address controller) private view returns (uint256 assets) {
        for (uint256 requestId = 1; requestId < nextDepositNonce; ++requestId) {
            DepositRecord storage request = deposits[depositIdByRequestId[requestId]];
            if (request.controller == controller && request.state == DepositState.Claimable) {
                assets += request.claimableAssets - request.claimedAssets;
            }
        }
    }

    function _claimableRedeemBalance(address controller) private view returns (uint256 shares) {
        for (uint256 requestId = 1; requestId < nextRedeemNonce; ++requestId) {
            RedeemRecord storage request = redeems[redeemIdByRequestId[requestId]];
            if (request.controller == controller && request.state == RedeemState.Claimable) {
                shares += request.sharesEscrowed - request.sharesClaimed;
            }
        }
    }

    function _previewDeposit(uint256 assets) private view returns (uint256 shares) {
        return convertToShares(assets);
    }

    function _previewMint(uint256 shares) private view returns (uint256 assets) {
        uint256 supply = totalSupply();
        if (supply == 0 || totalManagedAssets == 0) return shares;
        return Math.mulDiv(shares, totalManagedAssets, supply, Math.Rounding.Ceil);
    }

    function _previewRedeem(uint256 shares) private view returns (uint256 assets) {
        return convertToAssets(shares);
    }
}
