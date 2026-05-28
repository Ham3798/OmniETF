// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library OmniETFTypes {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant USDC_SCALE = 1e12; // 6 decimals -> 18 decimals
    uint256 internal constant WAD = 1e18;

    bytes32 internal constant AAPLX =
        hex"4141504c78000000000000000000000000000000000000000000000000000000";
    bytes32 internal constant TSLAX =
        hex"54534c4178000000000000000000000000000000000000000000000000000000";
    bytes32 internal constant NVDAX =
        hex"4e56444178000000000000000000000000000000000000000000000000000000";

    struct ReserveSnapshot {
        uint256 aaplxAmount; // 18 decimals of synthetic stock token
        uint256 tslaxAmount;
        uint256 nvdaxAmount;
        uint256 totalValueUsdc; // 6 decimals
        uint256 timestamp;
    }
}
