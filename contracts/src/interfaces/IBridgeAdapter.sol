// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBridgeAdapter {
    function sendAllocation(uint256 requestId, address user, uint256 usdcAmount) external;
    function sendRedeem(uint256 requestId, address user, uint256 shares, uint256 estimatedUsdc)
        external;
    function sendRebalance(uint256 requestId) external;
}
