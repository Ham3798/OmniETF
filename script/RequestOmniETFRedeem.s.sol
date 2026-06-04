// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

contract RequestOmniETFRedeem is Script {
    function run() external returns (uint256 requestId) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address controller = vm.addr(privateKey);
        address vaultAddress = vm.envAddress("OMNIETF_ASYNC_VAULT");
        uint256 shares = vm.envUint("REDEEM_SHARES");

        vm.startBroadcast(privateKey);
        requestId = OmniETFAsyncVault(vaultAddress).requestRedeem(shares, controller, controller);
        vm.stopBroadcast();
    }
}
