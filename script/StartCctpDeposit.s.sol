// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { CctpDepositRouter } from "../contracts/CctpDepositRouter.sol";

interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract StartCctpDeposit is Script {
    function run() external returns (bytes32 depositId) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address routerAddress = vm.envAddress("CCTP_DEPOSIT_ROUTER");
        address usdc = vm.envAddress("BASE_SEPOLIA_USDC");
        uint256 amount = vm.envUint("AMOUNT");
        uint256 maxFee = vm.envUint("MAX_FEE");
        bytes32 mintRecipient = vm.envBytes32("MINT_RECIPIENT_BYTES32");

        vm.startBroadcast(privateKey);
        IERC20Approve(usdc).approve(routerAddress, amount);
        depositId = CctpDepositRouter(routerAddress).deposit(amount, mintRecipient, maxFee);
        vm.stopBroadcast();
    }
}
