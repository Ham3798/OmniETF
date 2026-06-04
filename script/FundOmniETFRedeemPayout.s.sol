// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

interface IFundRedeemUsdcApprove {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract FundOmniETFRedeemPayout is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address vaultAddress = vm.envAddress("OMNIETF_ASYNC_VAULT");
        address usdc = vm.envAddress("BASE_SEPOLIA_USDC");
        bytes32 redeemId = vm.envBytes32("OMNIETF_REDEEM_ID");
        uint256 assetsClaimable = vm.envUint("REDEEM_ASSETS_CLAIMABLE");

        vm.startBroadcast(privateKey);
        IFundRedeemUsdcApprove(usdc).approve(vaultAddress, assetsClaimable);
        OmniETFAsyncVault(vaultAddress).fundRedeemPayout(redeemId, assetsClaimable);
        vm.stopBroadcast();
    }
}
