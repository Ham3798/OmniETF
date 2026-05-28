// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockPriceOracle} from "../src/mocks/MockPriceOracle.sol";
import {MockSolanaPortfolio} from "../src/mocks/MockSolanaPortfolio.sol";
import {MockBridgeAdapter} from "../src/mocks/MockBridgeAdapter.sol";
import {OmniETFManager} from "../src/OmniETFManager.sol";
import {OmniETFShare} from "../src/OmniETFShare.sol";
import {OmniETFTypes} from "../src/lib/OmniETFTypes.sol";

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
}

contract Demo {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event DemoStep(string label, uint256 value);
    event DemoAddress(string label, address value);

    uint256 internal constant USDC = 1e6;
    uint256 internal constant WAD = 1e18;

    function run() external {
        address owner = address(0xA11CE);
        address user = address(0xB0B);

        vm.startPrank(owner);
        MockUSDC usdc = new MockUSDC();
        MockPriceOracle oracle = new MockPriceOracle(owner);
        oracle.setPrice(OmniETFTypes.AAPLX, 100 * WAD);
        oracle.setPrice(OmniETFTypes.TSLAX, 200 * WAD);
        oracle.setPrice(OmniETFTypes.NVDAX, 50 * WAD);

        OmniETFShare share = new OmniETFShare(owner);
        OmniETFManager manager = new OmniETFManager(usdc, share, owner);
        MockSolanaPortfolio portfolio = new MockSolanaPortfolio(oracle, owner);
        MockBridgeAdapter bridge = new MockBridgeAdapter(usdc, manager, portfolio, owner);

        share.setManager(address(manager));
        manager.setBridge(bridge);
        portfolio.setExecutor(address(bridge));
        vm.stopPrank();

        emit DemoAddress("manager", address(manager));
        emit DemoAddress("share", address(share));
        emit DemoAddress("mockBridge", address(bridge));
        emit DemoAddress("mockSolanaPortfolio", address(portfolio));

        usdc.mint(user, 1_000 * USDC);
        vm.prank(user);
        usdc.approve(address(manager), type(uint256).max);
        emit DemoStep("user USDC before deposit", usdc.balanceOf(user));

        vm.prank(user);
        uint256 depositId = manager.requestDeposit(100 * USDC);
        emit DemoStep("deposit request id", depositId);
        emit DemoStep("shares before remote ack", share.balanceOf(user));
        vm.prank(owner);
        bridge.executeAllocation(depositId);
        vm.prank(owner);
        bridge.ackAllocation(depositId);
        emit DemoStep("shares after remote ack", share.balanceOf(user));
        emit DemoStep("portfolio value after deposit", manager.totalPortfolioValueUsdc());
        emit DemoStep("nav per share after deposit", manager.navPerShare());

        vm.prank(owner);
        oracle.setPrice(OmniETFTypes.AAPLX, 200 * WAD);
        vm.prank(owner);
        uint256 rebalanceId = manager.requestRebalance();
        vm.prank(owner);
        bridge.executeRebalance(rebalanceId);
        vm.prank(owner);
        bridge.ackRebalance(rebalanceId);
        emit DemoStep(
            "portfolio value after price sync/rebalance", manager.totalPortfolioValueUsdc()
        );
        emit DemoStep("nav per share after rebalance", manager.navPerShare());

        vm.prank(user);
        uint256 redeemId = manager.requestRedeem(50 ether);
        emit DemoStep("redeem request id", redeemId);
        emit DemoStep("shares after redeem request", share.balanceOf(user));
        vm.prank(owner);
        bridge.executeRedeem(redeemId);
        vm.prank(owner);
        bridge.ackRedeem(redeemId);
        emit DemoStep("claimable after redeem ack", manager.totalClaimableUsdc());
        vm.prank(user);
        manager.claimRedeem(redeemId);
        emit DemoStep("user USDC after claim", usdc.balanceOf(user));
    }
}
