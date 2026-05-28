// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { MockBridge } from "../src/MockBridge.sol";
import { MockUSDC } from "../src/MockUSDC.sol";
import { MultiChainETFVault } from "../src/MultiChainETFVault.sol";
import { ScriptBase } from "./ScriptBase.sol";

contract DeployBaseSepolia is ScriptBase {
    event DeploymentComplete(address indexed usdc, address indexed bridge, address indexed vault, address deployer);

    function run() external returns (MockUSDC usdc, MockBridge bridge, MultiChainETFVault vault) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        usdc = new MockUSDC();
        bridge = new MockBridge(address(usdc));
        vault = new MultiChainETFVault(address(usdc), address(bridge));

        emit DeploymentComplete(address(usdc), address(bridge), address(vault), msg.sender);

        vm.stopBroadcast();
    }
}
