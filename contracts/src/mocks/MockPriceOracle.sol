// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {Ownable} from "../lib/Ownable.sol";

contract MockPriceOracle is IPriceOracle, Ownable {
    mapping(bytes32 => uint256) public prices;

    event PriceSet(bytes32 indexed assetId, uint256 priceUsdWad);

    error MissingPrice(bytes32 assetId);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setPrice(bytes32 assetId, uint256 priceUsdWad) external onlyOwner {
        prices[assetId] = priceUsdWad;
        emit PriceSet(assetId, priceUsdWad);
    }

    function getPrice(bytes32 assetId) external view returns (uint256 priceUsdWad) {
        priceUsdWad = prices[assetId];
        if (priceUsdWad == 0) revert MissingPrice(assetId);
    }
}
