// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { MinimalERC20 } from "./MinimalERC20.sol";

contract MockUSDC is MinimalERC20 {
    constructor() MinimalERC20("Mock USDC", "USDC", 6) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
