// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MinimalERC20} from "../lib/MinimalERC20.sol";

contract MockUSDC is MinimalERC20 {
    constructor() MinimalERC20("Mock USDC", "mUSDC", 6) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
