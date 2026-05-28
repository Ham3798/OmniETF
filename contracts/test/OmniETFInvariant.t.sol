// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";

contract OmniETFInvariantTest is TestBase {
    function testAcknowledgedValueMatchesShareSupply() external {
        _deploy();
        _deposit(100 * USDC);
        _deposit(50 * USDC);

        uint256 left = (share.totalSupply() * manager.navPerShare()) / WAD / 1e12;
        uint256 right = manager.totalPortfolioValueUsdc() + usdc.balanceOf(address(manager))
            - manager.totalClaimableUsdc();
        require(_absDiff(left, right) <= 1, "invariant after deposits");

        vm.prank(user);
        uint256 redeemId = manager.requestRedeem(25 ether);
        vm.prank(owner);
        bridge.executeRedeem(redeemId);
        vm.prank(owner);
        bridge.ackRedeem(redeemId);

        left = (share.totalSupply() * manager.navPerShare()) / WAD / 1e12;
        right = manager.totalPortfolioValueUsdc() + usdc.balanceOf(address(manager))
            - manager.totalClaimableUsdc();
        require(_absDiff(left, right) <= 1, "invariant after redeem ack");
    }
}
