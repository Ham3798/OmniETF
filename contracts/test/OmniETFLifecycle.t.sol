// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {OmniETFManager} from "../src/OmniETFManager.sol";
import {OmniETFTypes} from "../src/lib/OmniETFTypes.sol";

contract OmniETFLifecycleTest is TestBase {
    function testDepositLifecycleIsAsync() external {
        _deploy();

        vm.prank(user);
        uint256 requestId = manager.requestDeposit(100 * USDC);

        (
            address requestUser,
            uint256 assets,
            uint256 mintedShares,
            OmniETFManager.RequestStatus status
        ) = manager.deposits(requestId);
        require(requestUser == user, "deposit user");
        require(assets == 100 * USDC, "deposit assets");
        require(mintedShares == 0, "no immediate mint");
        require(uint256(status) == uint256(OmniETFManager.RequestStatus.PendingRemote), "pending");
        require(share.balanceOf(user) == 0, "not minted yet");
        require(usdc.balanceOf(address(bridge)) == 100 * USDC, "bridge escrow");

        vm.prank(owner);
        bridge.executeAllocation(requestId);
        require(share.balanceOf(user) == 0, "still not minted before ack");

        vm.prank(owner);
        bridge.ackAllocation(requestId);
        require(share.balanceOf(user) == 100 ether, "minted after ack");
    }

    function testRedeemLifecycleClaim() external {
        _deploy();
        _deposit(100 * USDC);
        uint256 startingUsdc = usdc.balanceOf(user);

        vm.prank(user);
        uint256 redeemId = manager.requestRedeem(40 ether);
        require(share.balanceOf(user) == 60 ether, "burned on request");

        vm.prank(owner);
        bridge.executeRedeem(redeemId);
        vm.prank(owner);
        bridge.ackRedeem(redeemId);

        (address requestUser,, uint256 assets, OmniETFManager.RequestStatus status) =
            manager.redeems(redeemId);
        require(requestUser == user, "redeem user");
        require(assets == 40 * USDC, "claimable assets");
        require(uint256(status) == uint256(OmniETFManager.RequestStatus.Claimable), "claimable");

        vm.prank(user);
        manager.claimRedeem(redeemId);
        require(usdc.balanceOf(user) == startingUsdc + 40 * USDC, "claimed usdc");
        require(manager.totalClaimableUsdc() == 0, "claimable cleared");
    }

    function testDuplicateAckAndClaimRevert() external {
        _deploy();
        uint256 depositId = _deposit(100 * USDC);

        vm.prank(owner);
        vm.expectRevert();
        bridge.ackAllocation(depositId);

        vm.prank(user);
        uint256 redeemId = manager.requestRedeem(10 ether);
        vm.prank(owner);
        bridge.executeRedeem(redeemId);
        vm.prank(owner);
        bridge.ackRedeem(redeemId);
        vm.prank(user);
        manager.claimRedeem(redeemId);

        vm.prank(user);
        vm.expectRevert();
        manager.claimRedeem(redeemId);
    }

    function testUnauthorizedSettlementReverts() external {
        _deploy();
        vm.prank(user);
        uint256 requestId = manager.requestDeposit(100 * USDC);
        vm.prank(owner);
        bridge.executeAllocation(requestId);

        (
            uint256 aaplxAmount,
            uint256 tslaxAmount,
            uint256 nvdaxAmount,
            uint256 totalValueUsdc,
            uint256 timestamp
        ) = bridge.snapshots(requestId);
        OmniETFTypes.ReserveSnapshot memory snapshot = OmniETFTypes.ReserveSnapshot({
            aaplxAmount: aaplxAmount,
            tslaxAmount: tslaxAmount,
            nvdaxAmount: nvdaxAmount,
            totalValueUsdc: totalValueUsdc,
            timestamp: timestamp
        });
        vm.prank(user);
        vm.expectRevert();
        manager.settleDeposit(requestId, snapshot);
    }
}
