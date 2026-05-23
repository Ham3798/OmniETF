// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

contract FinalizeOmniETFDeposit is Script {
    function run() external returns (uint256 sharesMinted) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address vaultAddress = vm.envAddress("OMNIETF_ASYNC_VAULT");
        bytes32 depositId = vm.envBytes32("OMNIETF_DEPOSIT_ID");
        uint256 executedValue = vm.envUint("EXECUTED_VALUE_USDC");

        vm.startBroadcast(privateKey);
        sharesMinted = OmniETFAsyncVault(vaultAddress).finalizeDeposit(depositId, executedValue);
        vm.stopBroadcast();
    }
}
