// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPriceOracle {
    function getPrice(bytes32 assetId) external view returns (uint256 priceUsdWad);
}
