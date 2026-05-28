// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {IBridgeAdapter} from "../interfaces/IBridgeAdapter.sol";
import {OmniETFManager} from "../OmniETFManager.sol";
import {MockSolanaPortfolio} from "./MockSolanaPortfolio.sol";
import {OmniETFTypes} from "../lib/OmniETFTypes.sol";
import {Ownable} from "../lib/Ownable.sol";

contract MockBridgeAdapter is IBridgeAdapter, Ownable {
    IERC20 public immutable usdc;
    OmniETFManager public manager;
    MockSolanaPortfolio public portfolio;

    enum MessageType {
        None,
        Allocation,
        Redeem,
        Rebalance
    }

    enum MessageStatus {
        None,
        Sent,
        RemoteExecuted,
        Acked,
        Failed
    }

    struct BridgeMessage {
        uint256 requestId;
        address user;
        uint256 amount;
        uint256 shares;
        MessageType messageType;
        MessageStatus status;
    }

    mapping(uint256 => BridgeMessage) public messages;
    mapping(uint256 => OmniETFTypes.ReserveSnapshot) public snapshots;
    mapping(uint256 => uint256) public redeemReturns;

    event MessageSent(
        uint256 indexed requestId,
        MessageType indexed messageType,
        address indexed user,
        uint256 amount
    );
    event RemoteExecuted(
        uint256 indexed requestId, MessageType indexed messageType, uint256 totalValueUsdc
    );
    event MessageAcked(uint256 indexed requestId, MessageType indexed messageType);

    error NotManager();
    error InvalidMessage();
    error InvalidStatus();
    error TransferFailed();

    constructor(
        IERC20 usdc_,
        OmniETFManager manager_,
        MockSolanaPortfolio portfolio_,
        address initialOwner
    ) Ownable(initialOwner) {
        usdc = usdc_;
        manager = manager_;
        portfolio = portfolio_;
    }

    modifier onlyManager() {
        _onlyManager();
        _;
    }

    function _onlyManager() internal view {
        if (msg.sender != address(manager)) revert NotManager();
    }

    function sendAllocation(uint256 requestId, address user, uint256 usdcAmount)
        external
        onlyManager
    {
        _storeMessage(requestId, user, usdcAmount, 0, MessageType.Allocation);
    }

    function sendRedeem(uint256 requestId, address user, uint256 shares, uint256 estimatedUsdc)
        external
        onlyManager
    {
        _storeMessage(requestId, user, estimatedUsdc, shares, MessageType.Redeem);
    }

    function sendRebalance(uint256 requestId) external onlyManager {
        _storeMessage(requestId, address(0), 0, 0, MessageType.Rebalance);
    }

    function executeAllocation(uint256 requestId) external onlyOwner {
        BridgeMessage storage message = _sentMessage(requestId, MessageType.Allocation);
        OmniETFTypes.ReserveSnapshot memory snapshot = portfolio.allocate(requestId, message.amount);
        snapshots[requestId] = snapshot;
        message.status = MessageStatus.RemoteExecuted;
        emit RemoteExecuted(requestId, message.messageType, snapshot.totalValueUsdc);
    }

    function ackAllocation(uint256 requestId) external onlyOwner {
        BridgeMessage storage message = _executedMessage(requestId, MessageType.Allocation);
        message.status = MessageStatus.Acked;
        manager.settleDeposit(requestId, snapshots[requestId]);
        emit MessageAcked(requestId, message.messageType);
    }

    function executeRedeem(uint256 requestId) external onlyOwner {
        BridgeMessage storage message = _sentMessage(requestId, MessageType.Redeem);
        (uint256 returnedUsdc, OmniETFTypes.ReserveSnapshot memory snapshot) =
            portfolio.sellProRata(requestId, message.amount);
        snapshots[requestId] = snapshot;
        redeemReturns[requestId] = returnedUsdc;
        message.status = MessageStatus.RemoteExecuted;
        emit RemoteExecuted(requestId, message.messageType, snapshot.totalValueUsdc);
    }

    function ackRedeem(uint256 requestId) external onlyOwner {
        BridgeMessage storage message = _executedMessage(requestId, MessageType.Redeem);
        uint256 returnedUsdc = redeemReturns[requestId];
        message.status = MessageStatus.Acked;
        if (!usdc.transfer(address(manager), returnedUsdc)) revert TransferFailed();
        manager.settleRedeem(requestId, returnedUsdc, snapshots[requestId]);
        emit MessageAcked(requestId, message.messageType);
    }

    function executeRebalance(uint256 requestId) external onlyOwner {
        BridgeMessage storage message = _sentMessage(requestId, MessageType.Rebalance);
        OmniETFTypes.ReserveSnapshot memory snapshot = portfolio.rebalance();
        snapshots[requestId] = snapshot;
        message.status = MessageStatus.RemoteExecuted;
        emit RemoteExecuted(requestId, message.messageType, snapshot.totalValueUsdc);
    }

    function ackRebalance(uint256 requestId) external onlyOwner {
        BridgeMessage storage message = _executedMessage(requestId, MessageType.Rebalance);
        message.status = MessageStatus.Acked;
        manager.settleRebalance(requestId, snapshots[requestId]);
        emit MessageAcked(requestId, message.messageType);
    }

    function executeAndAckAllocation(uint256 requestId) external onlyOwner {
        this.executeAllocation(requestId);
        this.ackAllocation(requestId);
    }

    function executeAndAckRedeem(uint256 requestId) external onlyOwner {
        this.executeRedeem(requestId);
        this.ackRedeem(requestId);
    }

    function executeAndAckRebalance(uint256 requestId) external onlyOwner {
        this.executeRebalance(requestId);
        this.ackRebalance(requestId);
    }

    function _storeMessage(
        uint256 requestId,
        address user,
        uint256 amount,
        uint256 shares,
        MessageType messageType
    ) internal {
        if (messages[requestId].status != MessageStatus.None) {
            revert InvalidMessage();
        }
        messages[requestId] = BridgeMessage({
            requestId: requestId,
            user: user,
            amount: amount,
            shares: shares,
            messageType: messageType,
            status: MessageStatus.Sent
        });
        emit MessageSent(requestId, messageType, user, amount);
    }

    function _sentMessage(uint256 requestId, MessageType messageType)
        internal
        view
        returns (BridgeMessage storage message)
    {
        message = messages[requestId];
        if (message.messageType != messageType) revert InvalidMessage();
        if (message.status != MessageStatus.Sent) revert InvalidStatus();
    }

    function _executedMessage(uint256 requestId, MessageType messageType)
        internal
        view
        returns (BridgeMessage storage message)
    {
        message = messages[requestId];
        if (message.messageType != messageType) revert InvalidMessage();
        if (message.status != MessageStatus.RemoteExecuted) revert InvalidStatus();
    }
}
