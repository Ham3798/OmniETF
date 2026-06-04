// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

contract MarkOmniETFRedeemClaimable is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address vaultAddress = vm.envAddress("OMNIETF_ASYNC_VAULT");
        bytes32 redeemId = vm.envBytes32("OMNIETF_REDEEM_ID");
        uint256 assetsClaimable = vm.envUint("REDEEM_ASSETS_CLAIMABLE");

        vm.startBroadcast(privateKey);
        OmniETFAsyncVault(vaultAddress).markRedeemClaimable(redeemId, assetsClaimable);
        vm.stopBroadcast();
    }
}
