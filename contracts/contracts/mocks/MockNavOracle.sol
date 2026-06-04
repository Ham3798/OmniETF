// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/INavOracle.sol";

interface IVaultNAV {
    function updateNAV(uint256 newNav) external;
}

// Called by the off-chain coordinator to report Solana portfolio value on-chain.
contract MockNavOracle is INavOracle, Ownable {
    mapping(address => uint256) public latestNAV;
    mapping(address => uint256) public updatedAt;

    mapping(address => bool) public trustedReporters;

    event ReporterUpdated(address reporter, bool trusted);

    constructor() Ownable(msg.sender) {
        trustedReporters[msg.sender] = true;
    }

    modifier onlyReporter() {
        require(trustedReporters[msg.sender], "NavOracle: not a trusted reporter");
        _;
    }

    function setReporter(address reporter, bool trusted) external onlyOwner {
        trustedReporters[reporter] = trusted;
        emit ReporterUpdated(reporter, trusted);
    }

    function reportNAV(address vault, uint256 navValue) external override onlyReporter {
        latestNAV[vault] = navValue;
        updatedAt[vault] = block.timestamp;

        IVaultNAV(vault).updateNAV(navValue);

        emit NAVUpdated(navValue, block.timestamp);
    }

    function getLatestNAV(address vault) external view override returns (uint256 nav, uint256 ts) {
        return (latestNAV[vault], updatedAt[vault]);
    }
}
