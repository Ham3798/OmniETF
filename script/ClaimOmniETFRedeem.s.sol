// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

contract ClaimOmniETFRedeem is Script {
    function run() external returns (uint256 assetsClaimed) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address vaultAddress = vm.envAddress("OMNIETF_ASYNC_VAULT");
        bytes32 redeemId = vm.envBytes32("OMNIETF_REDEEM_ID");

        vm.startBroadcast(privateKey);
        assetsClaimed = OmniETFAsyncVault(vaultAddress).claimRedeem(redeemId);
        vm.stopBroadcast();
    }
}
