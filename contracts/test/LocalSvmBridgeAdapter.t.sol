// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {LocalSvmBridgeAdapter} from "../src/LocalSvmBridgeAdapter.sol";
import {OmniETFManager} from "../src/OmniETFManager.sol";
import {OmniETFShare} from "../src/OmniETFShare.sol";
import {OmniETFTypes} from "../src/lib/OmniETFTypes.sol";

interface VmLocalSvm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
}

contract LocalSvmBridgeAdapterTest {
    VmLocalSvm internal constant vm =
        VmLocalSvm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal owner = address(0xA11CE);
    address internal user = address(0xB0B);
    uint256 internal constant USDC = 1e6;
    uint256 internal constant WAD = 1e18;

    function testLocalSvmAdapterSettlesTrustedSnapshots() external {
        vm.startPrank(owner);
        MockUSDC usdc = new MockUSDC();
        OmniETFShare share = new OmniETFShare(owner);
        OmniETFManager manager = new OmniETFManager(usdc, share, owner);
        LocalSvmBridgeAdapter bridge = new LocalSvmBridgeAdapter(usdc, manager, owner);
        share.setManager(address(manager));
        manager.setBridge(bridge);
        vm.stopPrank();

        usdc.mint(user, 1_000 * USDC);
        vm.prank(user);
        usdc.approve(address(manager), type(uint256).max);

        vm.prank(user);
        uint256 depositId = manager.requestDeposit(100 * USDC);
        require(usdc.balanceOf(address(bridge)) == 100 * USDC, "escrow locked");

        vm.prank(owner);
        bridge.ackAllocation(depositId, _snapshot(100 * USDC));
        require(share.balanceOf(user) == 100 ether, "minted after svm ack");

        vm.prank(user);
        uint256 redeemId = manager.requestRedeem(40 ether);
        require(share.balanceOf(user) == 60 ether, "burned on request");

        vm.prank(owner);
        bridge.ackRedeem(redeemId, 40 * USDC, _snapshot(60 * USDC));
        require(manager.totalClaimableUsdc() == 40 * USDC, "claimable after return ack");
        require(usdc.balanceOf(address(manager)) == 40 * USDC, "manager funded");

        vm.prank(user);
        manager.claimRedeem(redeemId);
        require(usdc.balanceOf(user) == 940 * USDC, "user claimed returned usdc");
    }

    function _snapshot(uint256 totalValueUsdc)
        internal
        view
        returns (OmniETFTypes.ReserveSnapshot memory)
    {
        return OmniETFTypes.ReserveSnapshot({
            aaplxAmount: (totalValueUsdc * 40 * 1e12) / 100,
            tslaxAmount: (totalValueUsdc * 30 * 1e12) / 100,
            nvdaxAmount: (totalValueUsdc * 30 * 1e12) / 100,
            totalValueUsdc: totalValueUsdc,
            timestamp: block.timestamp
        });
    }
}
