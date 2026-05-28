// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IBridgeAdapter} from "./interfaces/IBridgeAdapter.sol";
import {OmniETFShare} from "./OmniETFShare.sol";
import {OmniETFTypes} from "./lib/OmniETFTypes.sol";
import {Ownable} from "./lib/Ownable.sol";

contract OmniETFManager is Ownable {
    IERC20 public immutable usdc;
    OmniETFShare public immutable share;
    IBridgeAdapter public bridge;

    uint256 public nextRequestId = 1;
    uint256 public totalPortfolioValueUsdc;
    uint256 public totalClaimableUsdc;
    OmniETFTypes.ReserveSnapshot public latestSnapshot;

    enum RequestStatus {
        None,
        PendingRemote,
        RemoteSettled,
        Claimable,
        Completed,
        Cancelled
    }

    struct DepositRequest {
        address user;
        uint256 assets;
        uint256 shares;
        RequestStatus status;
    }

    struct RedeemRequest {
        address user;
        uint256 shares;
        uint256 assets;
        RequestStatus status;
    }

    struct RebalanceRequest {
        RequestStatus status;
    }

    mapping(uint256 => DepositRequest) public deposits;
    mapping(uint256 => RedeemRequest) public redeems;
    mapping(uint256 => RebalanceRequest) public rebalances;

    event BridgeSet(address indexed bridge);
    event DepositRequested(uint256 indexed requestId, address indexed user, uint256 assets);
    event DepositSettled(
        uint256 indexed requestId, address indexed user, uint256 shares, uint256 totalValueUsdc
    );
    event RedeemRequested(
        uint256 indexed requestId, address indexed user, uint256 shares, uint256 estimatedAssets
    );
    event RedeemSettled(
        uint256 indexed requestId, address indexed user, uint256 assets, uint256 totalValueUsdc
    );
    event RedeemClaimed(uint256 indexed requestId, address indexed user, uint256 assets);
    event RebalanceRequested(uint256 indexed requestId);
    event RebalanceSettled(uint256 indexed requestId, uint256 totalValueUsdc);

    error BridgeAlreadySet();
    error BridgeNotSet();
    error NotBridge();
    error InvalidAmount();
    error InvalidRequest();
    error InvalidStatus();
    error TransferFailed();
    error SnapshotValueTooLow();

    constructor(IERC20 usdc_, OmniETFShare share_, address initialOwner) Ownable(initialOwner) {
        usdc = usdc_;
        share = share_;
    }

    modifier onlyBridge() {
        _onlyBridge();
        _;
    }

    function _onlyBridge() internal view {
        if (msg.sender != address(bridge)) revert NotBridge();
    }

    function setBridge(IBridgeAdapter bridge_) external onlyOwner {
        if (address(bridge) != address(0)) revert BridgeAlreadySet();
        bridge = bridge_;
        emit BridgeSet(address(bridge_));
    }

    function requestDeposit(uint256 assets) external returns (uint256 requestId) {
        if (address(bridge) == address(0)) revert BridgeNotSet();
        if (assets == 0) revert InvalidAmount();

        requestId = nextRequestId++;
        deposits[requestId] = DepositRequest({
            user: msg.sender, assets: assets, shares: 0, status: RequestStatus.PendingRemote
        });

        if (!usdc.transferFrom(msg.sender, address(bridge), assets)) revert TransferFailed();
        bridge.sendAllocation(requestId, msg.sender, assets);
        emit DepositRequested(requestId, msg.sender, assets);
    }

    function settleDeposit(uint256 requestId, OmniETFTypes.ReserveSnapshot calldata snapshot)
        external
        onlyBridge
    {
        DepositRequest storage request = deposits[requestId];
        if (request.user == address(0)) revert InvalidRequest();
        if (request.status != RequestStatus.PendingRemote) revert InvalidStatus();
        if (snapshot.totalValueUsdc < totalPortfolioValueUsdc) revert SnapshotValueTooLow();

        uint256 sharesToMint = _convertDepositToShares(request.assets);
        request.shares = sharesToMint;
        request.status = RequestStatus.Completed;
        _applySnapshot(snapshot);
        share.mint(request.user, sharesToMint);

        emit DepositSettled(requestId, request.user, sharesToMint, snapshot.totalValueUsdc);
    }

    function requestRedeem(uint256 shares) external returns (uint256 requestId) {
        if (address(bridge) == address(0)) revert BridgeNotSet();
        if (shares == 0) revert InvalidAmount();

        uint256 estimatedAssets = convertToAssets(shares);
        requestId = nextRequestId++;
        redeems[requestId] = RedeemRequest({
            user: msg.sender,
            shares: shares,
            assets: estimatedAssets,
            status: RequestStatus.PendingRemote
        });

        share.burn(msg.sender, shares);
        bridge.sendRedeem(requestId, msg.sender, shares, estimatedAssets);
        emit RedeemRequested(requestId, msg.sender, shares, estimatedAssets);
    }

    function settleRedeem(
        uint256 requestId,
        uint256 assetsReturned,
        OmniETFTypes.ReserveSnapshot calldata snapshot
    ) external onlyBridge {
        RedeemRequest storage request = redeems[requestId];
        if (request.user == address(0)) revert InvalidRequest();
        if (request.status != RequestStatus.PendingRemote) revert InvalidStatus();

        request.assets = assetsReturned;
        request.status = RequestStatus.Claimable;
        totalClaimableUsdc += assetsReturned;
        _applySnapshot(snapshot);

        emit RedeemSettled(requestId, request.user, assetsReturned, snapshot.totalValueUsdc);
    }

    function claimRedeem(uint256 requestId) external {
        RedeemRequest storage request = redeems[requestId];
        if (request.user != msg.sender) revert InvalidRequest();
        if (request.status != RequestStatus.Claimable) revert InvalidStatus();

        uint256 assets = request.assets;
        request.status = RequestStatus.Completed;
        totalClaimableUsdc -= assets;
        if (!usdc.transfer(msg.sender, assets)) revert TransferFailed();
        emit RedeemClaimed(requestId, msg.sender, assets);
    }

    function requestRebalance() external onlyOwner returns (uint256 requestId) {
        if (address(bridge) == address(0)) revert BridgeNotSet();
        requestId = nextRequestId++;
        rebalances[requestId] = RebalanceRequest({status: RequestStatus.PendingRemote});
        bridge.sendRebalance(requestId);
        emit RebalanceRequested(requestId);
    }

    function settleRebalance(uint256 requestId, OmniETFTypes.ReserveSnapshot calldata snapshot)
        external
        onlyBridge
    {
        RebalanceRequest storage request = rebalances[requestId];
        if (request.status != RequestStatus.PendingRemote) revert InvalidStatus();
        request.status = RequestStatus.Completed;
        _applySnapshot(snapshot);
        emit RebalanceSettled(requestId, snapshot.totalValueUsdc);
    }

    function navPerShare() public view returns (uint256) {
        uint256 supply = share.totalSupply();
        if (supply == 0) return OmniETFTypes.WAD;
        return (totalManagedAssetsUsdc() * OmniETFTypes.USDC_SCALE * OmniETFTypes.WAD) / supply;
    }

    function convertToAssets(uint256 shares_) public view returns (uint256) {
        return (shares_ * navPerShare()) / OmniETFTypes.WAD / OmniETFTypes.USDC_SCALE;
    }

    function totalManagedAssetsUsdc() public view returns (uint256) {
        uint256 managerHeld = usdc.balanceOf(address(this));
        return totalPortfolioValueUsdc + managerHeld - totalClaimableUsdc;
    }

    function _convertDepositToShares(uint256 assets) internal view returns (uint256) {
        uint256 supply = share.totalSupply();
        uint256 managedAssets = totalManagedAssetsUsdc();
        if (supply == 0 || managedAssets == 0) return assets * OmniETFTypes.USDC_SCALE;
        return
            (assets * OmniETFTypes.USDC_SCALE * supply) / (managedAssets * OmniETFTypes.USDC_SCALE);
    }

    function _applySnapshot(OmniETFTypes.ReserveSnapshot calldata snapshot) internal {
        latestSnapshot = snapshot;
        totalPortfolioValueUsdc = snapshot.totalValueUsdc;
    }
}
