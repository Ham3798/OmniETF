// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {OmniETFTypes} from "../src/lib/OmniETFTypes.sol";

contract OmniETFAccountingTest is TestBase {
    function testFirstDepositMintsOneSharePerUsdc() external {
        _deploy();
        _deposit(100 * USDC);

        require(share.balanceOf(user) == 100 ether, "share amount");
        require(share.totalSupply() == 100 ether, "supply");
        require(manager.totalPortfolioValueUsdc() == 100 * USDC, "portfolio value");
        require(manager.navPerShare() == WAD, "nav");
    }

    function testPriceMoveChangesNav() external {
        _deploy();
        _deposit(100 * USDC);

        vm.prank(owner);
        oracle.setPrice(OmniETFTypes.AAPLX, 200 * WAD);

        // Snapshot is explicit: price updates do not change Base accounting until the bridge syncs a new snapshot.
        require(manager.navPerShare() == WAD, "nav remains acknowledged value");

        vm.prank(owner);
        uint256 rebalanceId = manager.requestRebalance();
        vm.prank(owner);
        bridge.executeRebalance(rebalanceId);
        vm.prank(owner);
        bridge.ackRebalance(rebalanceId);

        require(manager.totalPortfolioValueUsdc() == 140 * USDC, "portfolio repriced");
        require(manager.navPerShare() == 14e17, "nav after sync");
    }

    function testTargetWeightsMustSumToBps() external {
        _deploy();
        vm.prank(owner);
        vm.expectRevert();
        portfolio.setTargetWeights(4_000, 4_000, 3_000);

        vm.prank(owner);
        portfolio.setTargetWeights(5_000, 2_000, 3_000);
        require(portfolio.aaplxWeightBps() == 5_000, "aapl weight");
    }

    function testSecondDepositUsesCurrentNav() external {
        _deploy();
        _deposit(100 * USDC);

        vm.prank(owner);
        oracle.setPrice(OmniETFTypes.AAPLX, 200 * WAD);
        vm.prank(owner);
        uint256 rebalanceId = manager.requestRebalance();
        vm.prank(owner);
        bridge.executeRebalance(rebalanceId);
        vm.prank(owner);
        bridge.ackRebalance(rebalanceId);

        _deposit(140 * USDC);
        require(share.balanceOf(user) == 200 ether, "second deposit mints at 1.4 nav");
        require(manager.navPerShare() == 14e17, "nav preserved");
    }
}
