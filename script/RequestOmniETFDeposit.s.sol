// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

interface IAsyncVaultUsdcApprove {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract RequestOmniETFDeposit is Script {
    function run() external returns (uint256 requestId) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address controller = vm.addr(privateKey);
        address vaultAddress = vm.envAddress("OMNIETF_ASYNC_VAULT");
        address usdc = vm.envAddress("BASE_SEPOLIA_USDC");
        uint256 amount = vm.envUint("AMOUNT");
        uint256 maxFee = vm.envUint("MAX_FEE");
        bytes32 solanaUsdcTokenAccount = vm.envBytes32("MINT_RECIPIENT_BYTES32");

        vm.startBroadcast(privateKey);
        OmniETFAsyncVault(vaultAddress).setDepositRoute(solanaUsdcTokenAccount, maxFee);
        IAsyncVaultUsdcApprove(usdc).approve(vaultAddress, amount);
        requestId = OmniETFAsyncVault(vaultAddress).requestDeposit(amount, controller, controller);
        vm.stopBroadcast();
    }
}
