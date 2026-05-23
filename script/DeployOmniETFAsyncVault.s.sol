// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

contract DeployOmniETFAsyncVault is Script {
    function run() external returns (OmniETFAsyncVault vault) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("BASE_SEPOLIA_USDC");
        address tokenMessenger = vm.envAddress("BASE_SEPOLIA_TOKEN_MESSENGER_V2");
        uint32 destinationDomain = uint32(vm.envUint("DESTINATION_DOMAIN"));
        bytes32 destinationCaller = vm.envBytes32("DESTINATION_CALLER_BYTES32");
        uint32 minFinalityThreshold = uint32(vm.envUint("MIN_FINALITY_THRESHOLD"));
        address reporter = vm.envOr("REPORTER", vm.addr(privateKey));

        vm.startBroadcast(privateKey);
        vault = new OmniETFAsyncVault(
            usdc,
            tokenMessenger,
            destinationDomain,
            destinationCaller,
            minFinalityThreshold,
            reporter
        );
        vm.stopBroadcast();
    }
}
