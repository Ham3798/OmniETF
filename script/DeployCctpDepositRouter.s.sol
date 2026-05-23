// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { CctpDepositRouter } from "../contracts/CctpDepositRouter.sol";

contract DeployCctpDepositRouter is Script {
    function run() external returns (CctpDepositRouter router) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("BASE_SEPOLIA_USDC");
        address tokenMessenger = vm.envAddress("BASE_SEPOLIA_TOKEN_MESSENGER_V2");
        uint32 destinationDomain = uint32(vm.envUint("DESTINATION_DOMAIN"));
        bytes32 destinationCaller = vm.envBytes32("DESTINATION_CALLER_BYTES32");
        uint32 minFinalityThreshold = uint32(vm.envUint("MIN_FINALITY_THRESHOLD"));

        vm.startBroadcast(privateKey);
        router = new CctpDepositRouter(
            usdc, tokenMessenger, destinationDomain, destinationCaller, minFinalityThreshold
        );
        vm.stopBroadcast();
    }
}
