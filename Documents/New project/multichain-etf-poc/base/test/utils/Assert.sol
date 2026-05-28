// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract Assert {
    function assertEq(uint256 left, uint256 right, string memory message) internal pure {
        require(left == right, message);
    }

    function assertTrue(bool condition, string memory message) internal pure {
        require(condition, message);
    }
}
