// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IBridge.sol";

interface IVaultFulfill {
    function fulfillRedeem(uint256 redeemId) external;
}

// Mock bridge for PoC. In production, replace with Wormhole/LayerZero.
// Off-chain coordinator listens to BridgeRequested events, executes on Solana,
// then calls completeRedeem() to settle back on Base.
contract MockBridge is IBridge, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public vault;

    mapping(uint256 => bool) public processedDeposits;
    mapping(uint256 => bool) public processedRedeems;

    event VaultSet(address vault);

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
        emit VaultSet(_vault);
    }

    function bridgeToSolana(
        uint256 amount,
        bytes32 solanaRecipient,
        uint256 depositId
    ) external override {
        require(msg.sender == vault, "MockBridge: only vault");
        require(!processedDeposits[depositId], "MockBridge: already processed");
        processedDeposits[depositId] = true;

        usdc.safeTransferFrom(vault, address(this), amount);

        emit BridgeRequested(depositId, vault, amount, solanaRecipient);
    }

    // Called by the off-chain coordinator after Solana execute_redeem completes.
    function completeRedeem(
        address user,
        uint256 usdcAmount,
        uint256 redeemId
    ) external override onlyOwner {
        require(!processedRedeems[redeemId], "MockBridge: redeem already completed");
        processedRedeems[redeemId] = true;

        usdc.safeTransfer(user, usdcAmount);

        // Notify the vault that this redeem is settled
        IVaultFulfill(vault).fulfillRedeem(redeemId);

        emit RedeemCompleted(redeemId, user, usdcAmount);
    }

    // Emergency: owner can recover tokens locked in bridge
    function recoverTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
