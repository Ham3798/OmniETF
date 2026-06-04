// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBridge {
    event BridgeRequested(
        uint256 indexed depositId,
        address indexed sender,
        uint256 amount,
        bytes32 solanaRecipient
    );

    event RedeemCompleted(
        uint256 indexed redeemId,
        address indexed user,
        uint256 usdcAmount
    );

    function bridgeToSolana(
        uint256 amount,
        bytes32 solanaRecipient,
        uint256 depositId
    ) external;

    function completeRedeem(
        address user,
        uint256 usdcAmount,
        uint256 redeemId
    ) external;
}
