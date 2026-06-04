// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

contract ClaimOmniETFDeposit is Script {
    function run() external returns (uint256 shares) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address controller = vm.addr(privateKey);
        address vaultAddress = vm.envAddress("OMNIETF_ASYNC_VAULT");
        uint256 assets = vm.envUint("CLAIM_ASSETS");

        vm.startBroadcast(privateKey);
        shares = OmniETFAsyncVault(vaultAddress).deposit(assets, controller, controller);
        vm.stopBroadcast();
    }
}
