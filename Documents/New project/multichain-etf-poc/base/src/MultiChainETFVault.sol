// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { MinimalERC20 } from "./MinimalERC20.sol";
import { MockBridge, IBridgeReceiver } from "./MockBridge.sol";

contract MultiChainETFVault is MinimalERC20, IBridgeReceiver {
    error NotOwner();
    error NotBridge();
    error ZeroAmount();
    error InvalidReceiver();
    error InsufficientBaseLiquidity();
    error InsufficientSolanaLiquidity();
    error RedemptionAlreadySettled();
    error UnknownRedemption();
    error TokenTransferFailed();

    struct RedemptionRequest {
        address owner;
        address receiver;
        uint256 shares;
        uint256 assets;
        bool settled;
    }

    MinimalERC20 public immutable asset;
    MockBridge public bridge;
    address public owner;

    uint256 public baseIdleAssets;
    uint256 public solanaManagedAssets;
    uint256 public reservedRedemptionAssets;
    uint64 public nextRedemptionId;

    mapping(uint64 redemptionId => RedemptionRequest request) public redemptions;

    event BridgeUpdated(address indexed bridge);
    event DepositRecorded(address indexed caller, address indexed receiver, uint256 assets, uint256 shares);
    event AssetsBridgedToSolana(uint64 indexed messageId, uint256 assets, bytes32 actionId);
    event SolanaNavUpdated(uint256 solanaManagedAssets, uint256 activeAssets);
    event RedemptionRequested(
        uint64 indexed redemptionId,
        address indexed owner,
        address indexed receiver,
        uint256 shares,
        uint256 assets
    );
    event SolanaLiquidityPrepared(uint256 assets);
    event BridgeReturnRecorded(uint256 amount);
    event RedemptionSettled(uint64 indexed redemptionId, address indexed receiver, uint256 assets);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyBridge() {
        if (msg.sender != address(bridge)) revert NotBridge();
        _;
    }

    constructor(address asset_, address bridge_) MinimalERC20("Multichain ETF Share", "mETF", 6) {
        asset = MinimalERC20(asset_);
        bridge = MockBridge(bridge_);
        owner = msg.sender;
    }

    function setBridge(address bridge_) external onlyOwner {
        bridge = MockBridge(bridge_);
        emit BridgeUpdated(bridge_);
    }

    function totalAssets() public view returns (uint256) {
        return baseIdleAssets + solanaManagedAssets - reservedRedemptionAssets;
    }

    function grossManagedAssets() public view returns (uint256) {
        return baseIdleAssets + solanaManagedAssets;
    }

    function convertToShares(uint256 assets) public view returns (uint256 shares) {
        uint256 supply = totalSupply;
        uint256 activeAssets = totalAssets();

        if (supply == 0 || activeAssets == 0) {
            return assets;
        }

        shares = (assets * supply) / activeAssets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256 assets) {
        uint256 supply = totalSupply;
        uint256 activeAssets = totalAssets();

        if (supply == 0 || activeAssets == 0) {
            return shares;
        }

        assets = (shares * activeAssets) / supply;
    }

    function previewDeposit(uint256 assets) external view returns (uint256 shares) {
        return convertToShares(assets);
    }

    function previewRedeem(uint256 shares) external view returns (uint256 assets) {
        return convertToAssets(shares);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidReceiver();

        shares = convertToShares(assets);
        if (shares == 0) revert ZeroAmount();

        bool transferredIn = asset.transferFrom(msg.sender, address(this), assets);
        if (!transferredIn) revert TokenTransferFailed();
        baseIdleAssets += assets;
        _mint(receiver, shares);

        emit DepositRecorded(msg.sender, receiver, assets, shares);
    }

    function bridgeToSolana(uint256 assets, bytes32 actionId) external onlyOwner returns (uint64 messageId) {
        if (assets == 0) revert ZeroAmount();
        if (baseIdleAssets < assets) revert InsufficientBaseLiquidity();

        baseIdleAssets -= assets;
        solanaManagedAssets += assets;

        bool transferredToBridge = asset.transfer(address(bridge), assets);
        if (!transferredToBridge) revert TokenTransferFailed();
        messageId = bridge.recordOutbound(address(this), assets, actionId);

        emit AssetsBridgedToSolana(messageId, assets, actionId);
    }

    function recordSolanaNav(uint256 newSolanaManagedAssets) external onlyOwner {
        solanaManagedAssets = newSolanaManagedAssets;
        emit SolanaNavUpdated(newSolanaManagedAssets, totalAssets());
    }

    function requestRedeem(uint256 shares, address receiver) external returns (uint64 redemptionId, uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert InvalidReceiver();

        assets = convertToAssets(shares);
        if (assets == 0) revert ZeroAmount();

        _burn(msg.sender, shares);
        reservedRedemptionAssets += assets;

        redemptionId = ++nextRedemptionId;
        redemptions[redemptionId] = RedemptionRequest({
            owner: msg.sender,
            receiver: receiver,
            shares: shares,
            assets: assets,
            settled: false
        });

        emit RedemptionRequested(redemptionId, msg.sender, receiver, shares, assets);
    }

    function prepareRedemptionLiquidity(uint256 assets) external onlyOwner {
        if (assets == 0) revert ZeroAmount();
        if (solanaManagedAssets < assets) revert InsufficientSolanaLiquidity();

        solanaManagedAssets -= assets;
        emit SolanaLiquidityPrepared(assets);
    }

    function onBridgeReturn(uint256 amount) external onlyBridge {
        baseIdleAssets += amount;
        emit BridgeReturnRecorded(amount);
    }

    function settleRedeem(uint64 redemptionId) external returns (uint256 assets) {
        RedemptionRequest storage request = redemptions[redemptionId];

        if (request.receiver == address(0)) revert UnknownRedemption();
        if (request.settled) revert RedemptionAlreadySettled();
        if (baseIdleAssets < request.assets) revert InsufficientBaseLiquidity();

        request.settled = true;
        assets = request.assets;

        baseIdleAssets -= assets;
        reservedRedemptionAssets -= assets;
        bool transferredOut = asset.transfer(request.receiver, assets);
        if (!transferredOut) revert TokenTransferFailed();

        emit RedemptionSettled(redemptionId, request.receiver, assets);
    }
}
