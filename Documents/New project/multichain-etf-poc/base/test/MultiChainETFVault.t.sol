// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { MockBridge } from "../src/MockBridge.sol";
import { MockUSDC } from "../src/MockUSDC.sol";
import { MultiChainETFVault } from "../src/MultiChainETFVault.sol";
import { Assert } from "./utils/Assert.sol";

contract UserActor {
    function approveAndDeposit(address usdc, address vault, uint256 amount) external {
        MockUSDC(usdc).approve(vault, amount);
        MultiChainETFVault(vault).deposit(amount, address(this));
    }

    function requestRedeem(address vault, uint256 shares) external returns (uint64 redemptionId, uint256 assets) {
        return MultiChainETFVault(vault).requestRedeem(shares, address(this));
    }
}

contract MultiChainETFVaultTest is Assert {
    MockUSDC internal usdc;
    MockBridge internal bridge;
    MultiChainETFVault internal vault;
    UserActor internal alice;

    function setUp() public {
        usdc = new MockUSDC();
        bridge = new MockBridge(address(usdc));
        vault = new MultiChainETFVault(address(usdc), address(bridge));
        alice = new UserActor();
    }

    function testDepositBridgeNavAndRedeemFlow() public {
        uint256 depositAmount = 100_000_000;
        usdc.mint(address(alice), depositAmount);

        alice.approveAndDeposit(address(usdc), address(vault), depositAmount);

        assertEq(vault.balanceOf(address(alice)), depositAmount, "shares minted");
        assertEq(vault.baseIdleAssets(), depositAmount, "vault keeps base idle assets");
        assertEq(usdc.balanceOf(address(vault)), depositAmount, "vault receives deposit");

        uint64 depositMessageId = vault.bridgeToSolana(depositAmount, bytes32("deposit-1"));
        assertEq(depositMessageId, 1, "first bridge message id");
        assertEq(vault.baseIdleAssets(), 0, "base idle drained");
        assertEq(vault.solanaManagedAssets(), depositAmount, "solana position reflected");
        assertEq(usdc.balanceOf(address(bridge)), depositAmount, "bridge custody funded");

        vault.recordSolanaNav(110_000_000);
        assertEq(vault.totalAssets(), 110_000_000, "nav updated on base");

        (uint64 redemptionId, uint256 redeemAssets) = alice.requestRedeem(address(vault), 50_000_000);
        assertEq(redemptionId, 1, "first redemption id");
        assertEq(redeemAssets, 55_000_000, "half shares redeem half of updated nav");
        assertEq(vault.reservedRedemptionAssets(), 55_000_000, "redeem claim reserved");
        assertEq(vault.totalAssets(), 55_000_000, "remaining holders keep only active nav");

        vault.prepareRedemptionLiquidity(redeemAssets);
        assertEq(vault.solanaManagedAssets(), 55_000_000, "solana nav reduced before bridge back");

        bridge.releaseToVault(depositMessageId, redeemAssets);
        assertEq(vault.baseIdleAssets(), redeemAssets, "bridge return restores base liquidity");
        assertEq(usdc.balanceOf(address(vault)), redeemAssets, "vault holds bridged back usdc");

        uint256 settledAssets = vault.settleRedeem(redemptionId);
        assertEq(settledAssets, redeemAssets, "settled assets match reserved amount");
        assertEq(usdc.balanceOf(address(alice)), redeemAssets, "alice receives redeemed usdc");
        assertEq(vault.reservedRedemptionAssets(), 0, "reservation cleared");
        assertEq(vault.baseIdleAssets(), 0, "base liquidity paid out");
        assertEq(vault.balanceOf(address(alice)), 50_000_000, "alice keeps half the shares");
        assertEq(vault.totalAssets(), 55_000_000, "remaining nav belongs to remaining shares");
    }
}
