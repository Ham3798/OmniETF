// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { MinimalERC20 } from "./MinimalERC20.sol";

interface IBridgeReceiver {
    function onBridgeReturn(uint256 amount) external;
}

contract MockBridge {
    error NotOwner();
    error MessageAlreadyFulfilled();
    error UnknownMessage();
    error TokenTransferFailed();

    struct Message {
        address vault;
        uint256 amount;
        bytes32 actionId;
        bool fulfilled;
    }

    MinimalERC20 public immutable asset;
    address public owner;
    uint64 public nextMessageId;

    mapping(uint64 messageId => Message message) public messages;

    event OutboundRecorded(uint64 indexed messageId, address indexed vault, uint256 amount, bytes32 actionId);
    event InboundReleased(uint64 indexed messageId, address indexed vault, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address asset_) {
        asset = MinimalERC20(asset_);
        owner = msg.sender;
    }

    function recordOutbound(address vault, uint256 amount, bytes32 actionId) external returns (uint64 messageId) {
        messageId = ++nextMessageId;
        messages[messageId] = Message({ vault: vault, amount: amount, actionId: actionId, fulfilled: false });

        emit OutboundRecorded(messageId, vault, amount, actionId);
    }

    function releaseToVault(uint64 messageId, uint256 amount) external onlyOwner {
        Message storage message = messages[messageId];

        if (message.vault == address(0)) revert UnknownMessage();
        if (message.fulfilled) revert MessageAlreadyFulfilled();

        message.fulfilled = true;
        bool transferred = asset.transfer(message.vault, amount);
        if (!transferred) revert TokenTransferFailed();
        IBridgeReceiver(message.vault).onBridgeReturn(amount);

        emit InboundReleased(messageId, message.vault, amount);
    }
}
