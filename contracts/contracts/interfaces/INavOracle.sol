// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface INavOracle {
    event NAVUpdated(uint256 newNAV, uint256 timestamp);

    function reportNAV(address vault, uint256 navValue) external;

    function getLatestNAV(address vault) external view returns (uint256 nav, uint256 updatedAt);
}
