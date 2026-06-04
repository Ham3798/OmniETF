// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Script } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AccessManager } from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import { OmniETFOZAsyncVault } from "../contracts/OmniETFOZAsyncVault.sol";

contract DeployOmniETFOZAsyncVault is Script {
    function run() external returns (OmniETFOZAsyncVault vault, AccessManager accessManager) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(privateKey);
        address usdc = vm.envAddress("BASE_SEPOLIA_USDC");
        address tokenMessenger = vm.envAddress("BASE_SEPOLIA_TOKEN_MESSENGER_V2");
        uint32 destinationDomain = uint32(vm.envUint("DESTINATION_DOMAIN"));
        bytes32 destinationCaller = vm.envBytes32("DESTINATION_CALLER_BYTES32");
        uint32 minFinalityThreshold = uint32(vm.envUint("MIN_FINALITY_THRESHOLD"));
        address reporter = vm.envOr("REPORTER", admin);
        address initialOwner = vm.envOr("OMNIETF_OWNER", admin);

        vm.startBroadcast(privateKey);
        accessManager = new AccessManager(admin);
        vault = new OmniETFOZAsyncVault(
            IERC20(usdc),
            tokenMessenger,
            destinationDomain,
            destinationCaller,
            minFinalityThreshold,
            address(accessManager),
            initialOwner
        );
        _configureAccess(accessManager, vault, reporter);
        vm.stopBroadcast();
    }

    function _configureAccess(
        AccessManager accessManager,
        OmniETFOZAsyncVault vault,
        address reporter
    ) private {
        bytes4[] memory reporterSelectors = new bytes4[](6);
        reporterSelectors[0] = vault.markDepositSettled.selector;
        reporterSelectors[1] = vault.markDepositExecuted.selector;
        reporterSelectors[2] = vault.finalizeDeposit.selector;
        reporterSelectors[3] = vault.fundRedeemPayout.selector;
        reporterSelectors[4] = vault.markRedeemClaimable.selector;
        reporterSelectors[5] = vault.reportTotalManagedAssets.selector;

        bytes4[] memory pauserSelectors = new bytes4[](2);
        pauserSelectors[0] = vault.pause.selector;
        pauserSelectors[1] = vault.unpause.selector;

        accessManager.labelRole(vault.REPORTER_ROLE_ID(), "REPORTER_ROLE");
        accessManager.labelRole(vault.PAUSER_ROLE_ID(), "PAUSER_ROLE");
        accessManager.grantRole(vault.REPORTER_ROLE_ID(), reporter, 0);
        accessManager.grantRole(vault.PAUSER_ROLE_ID(), reporter, 0);
        accessManager.setTargetFunctionRole(
            address(vault), reporterSelectors, vault.REPORTER_ROLE_ID()
        );
        accessManager.setTargetFunctionRole(address(vault), pauserSelectors, vault.PAUSER_ROLE_ID());
    }
}
