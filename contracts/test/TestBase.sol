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
    function expectRevert() external;
}

contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockUSDC internal usdc;
    MockPriceOracle internal oracle;
    MockSolanaPortfolio internal portfolio;
    MockBridgeAdapter internal bridge;
    OmniETFShare internal share;
    OmniETFManager internal manager;

    address internal owner = address(0xA11CE);
    address internal user = address(0xB0B);

    uint256 internal constant USDC = 1e6;
    uint256 internal constant WAD = 1e18;

    function _deploy() internal {
        vm.startPrank(owner);
        usdc = new MockUSDC();
        oracle = new MockPriceOracle(owner);
        oracle.setPrice(OmniETFTypes.AAPLX, 100 * WAD);
        oracle.setPrice(OmniETFTypes.TSLAX, 200 * WAD);
        oracle.setPrice(OmniETFTypes.NVDAX, 50 * WAD);
        share = new OmniETFShare(owner);
        manager = new OmniETFManager(usdc, share, owner);
        portfolio = new MockSolanaPortfolio(oracle, owner);
        bridge = new MockBridgeAdapter(usdc, manager, portfolio, owner);
        share.setManager(address(manager));
        manager.setBridge(bridge);
        portfolio.setExecutor(address(bridge));
        vm.stopPrank();

        usdc.mint(user, 1_000 * USDC);
        vm.prank(user);
        usdc.approve(address(manager), type(uint256).max);
    }

    function _deposit(uint256 amountUsdc) internal returns (uint256 requestId) {
        vm.prank(user);
        requestId = manager.requestDeposit(amountUsdc);
        vm.prank(owner);
        bridge.executeAllocation(requestId);
        vm.prank(owner);
        bridge.ackAllocation(requestId);
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : b - a;
    }
}
