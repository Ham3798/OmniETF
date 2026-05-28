// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IBridgeAdapter} from "./interfaces/IBridgeAdapter.sol";
import {OmniETFManager} from "./OmniETFManager.sol";
import {OmniETFTypes} from "./lib/OmniETFTypes.sol";
import {Ownable} from "./lib/Ownable.sol";

/// @notice Local-only trusted relayer adapter for Anvil <-> solana-test-validator demos.
/// @dev This is not a production bridge. The owner/relayer is trusted to submit SVM snapshots.
contract LocalSvmBridgeAdapter is IBridgeAdapter, Ownable {
    IERC20 public immutable usdc;
    OmniETFManager public immutable manager;

    enum MessageType {
        None,
        Allocation,
        Redeem,
        Rebalance
    }

    enum MessageStatus {
        None,
        Sent,
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

    event LocalSvmIntent(
        uint256 indexed requestId,
        MessageType indexed messageType,
        address indexed user,
        uint256 amount,
        uint256 shares
    );
    event LocalSvmAcked(
        uint256 indexed requestId,
        MessageType indexed messageType,
        uint256 returnedUsdc,
        uint256 totalValueUsdc
    );

    error NotManager();
    error InvalidMessage();
    error InvalidStatus();
    error TransferFailed();

    constructor(IERC20 usdc_, OmniETFManager manager_, address initialOwner) Ownable(initialOwner) {
        usdc = usdc_;
        manager = manager_;
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

    function ackAllocation(uint256 requestId, OmniETFTypes.ReserveSnapshot calldata snapshot)
        external
        onlyOwner
    {
        BridgeMessage storage message = _sentMessage(requestId, MessageType.Allocation);
        message.status = MessageStatus.Acked;
        manager.settleDeposit(requestId, snapshot);
        emit LocalSvmAcked(requestId, message.messageType, 0, snapshot.totalValueUsdc);
    }

    function ackRedeem(
        uint256 requestId,
        uint256 returnedUsdc,
        OmniETFTypes.ReserveSnapshot calldata snapshot
    ) external onlyOwner {
        BridgeMessage storage message = _sentMessage(requestId, MessageType.Redeem);
        message.status = MessageStatus.Acked;
        if (!usdc.transfer(address(manager), returnedUsdc)) revert TransferFailed();
        manager.settleRedeem(requestId, returnedUsdc, snapshot);
        emit LocalSvmAcked(requestId, message.messageType, returnedUsdc, snapshot.totalValueUsdc);
    }

    function ackRebalance(uint256 requestId, OmniETFTypes.ReserveSnapshot calldata snapshot)
        external
        onlyOwner
    {
        BridgeMessage storage message = _sentMessage(requestId, MessageType.Rebalance);
        message.status = MessageStatus.Acked;
        manager.settleRebalance(requestId, snapshot);
        emit LocalSvmAcked(requestId, message.messageType, 0, snapshot.totalValueUsdc);
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
        emit LocalSvmIntent(requestId, messageType, user, amount, shares);
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
}
