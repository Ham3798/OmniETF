// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MinimalERC20} from "./lib/MinimalERC20.sol";
import {Ownable} from "./lib/Ownable.sol";

contract OmniETFShare is MinimalERC20, Ownable {
    address public manager;

    event ManagerSet(address indexed manager);

    error NotManager();
    error ManagerAlreadySet();

    constructor(address initialOwner)
        MinimalERC20("OmniETF Share", "mETF", 18)
        Ownable(initialOwner)
    {}

    modifier onlyManager() {
        _onlyManager();
        _;
    }

    function _onlyManager() internal view {
        if (msg.sender != manager) revert NotManager();
    }

    function setManager(address newManager) external onlyOwner {
        if (manager != address(0)) revert ManagerAlreadySet();
        manager = newManager;
        emit ManagerSet(newManager);
    }

    function mint(address to, uint256 amount) external onlyManager {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyManager {
        _burn(from, amount);
    }
}
