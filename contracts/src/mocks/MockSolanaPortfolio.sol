// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {OmniETFTypes} from "../lib/OmniETFTypes.sol";
import {Ownable} from "../lib/Ownable.sol";

contract MockSolanaPortfolio is Ownable {
    using OmniETFTypes for OmniETFTypes.ReserveSnapshot;

    IPriceOracle public oracle;
    address public executor;

    uint256 public aaplxBalance;
    uint256 public tslaxBalance;
    uint256 public nvdaxBalance;

    uint16 public aaplxWeightBps = 4_000;
    uint16 public tslaxWeightBps = 3_000;
    uint16 public nvdaxWeightBps = 3_000;

    event Allocated(uint256 indexed requestId, uint256 usdcAmount, uint256 totalValueUsdc);
    event Sold(uint256 indexed requestId, uint256 usdcAmount, uint256 totalValueUsdc);
    event Rebalanced(uint256 totalValueUsdc);
    event TargetWeightsSet(uint16 aaplxBps, uint16 tslaxBps, uint16 nvdaxBps);
    event ExecutorSet(address indexed executor);

    error InvalidWeights();
    error InsufficientPortfolioValue();
    error NotExecutor();

    constructor(IPriceOracle oracle_, address initialOwner) Ownable(initialOwner) {
        oracle = oracle_;
    }

    modifier onlyExecutor() {
        _onlyExecutor();
        _;
    }

    function _onlyExecutor() internal view {
        if (msg.sender != executor) revert NotExecutor();
    }

    function setExecutor(address executor_) external onlyOwner {
        executor = executor_;
        emit ExecutorSet(executor_);
    }

    function setTargetWeights(uint16 aaplxBps, uint16 tslaxBps, uint16 nvdaxBps)
        external
        onlyOwner
    {
        if (uint256(aaplxBps) + tslaxBps + nvdaxBps != OmniETFTypes.BPS) {
            revert InvalidWeights();
        }
        aaplxWeightBps = aaplxBps;
        tslaxWeightBps = tslaxBps;
        nvdaxWeightBps = nvdaxBps;
        emit TargetWeightsSet(aaplxBps, tslaxBps, nvdaxBps);
    }

    function allocate(uint256 requestId, uint256 usdcAmount)
        external
        onlyExecutor
        returns (OmniETFTypes.ReserveSnapshot memory snapshot)
    {
        uint256 valueWad = usdcAmount * OmniETFTypes.USDC_SCALE;
        aaplxBalance += _usdValueToAssetAmount(
            (valueWad * aaplxWeightBps) / OmniETFTypes.BPS, OmniETFTypes.AAPLX
        );
        tslaxBalance += _usdValueToAssetAmount(
            (valueWad * tslaxWeightBps) / OmniETFTypes.BPS, OmniETFTypes.TSLAX
        );
        nvdaxBalance += _usdValueToAssetAmount(
            (valueWad * nvdaxWeightBps) / OmniETFTypes.BPS, OmniETFTypes.NVDAX
        );
        snapshot = snapshotNow();
        emit Allocated(requestId, usdcAmount, snapshot.totalValueUsdc);
    }

    function sellProRata(uint256 requestId, uint256 usdcAmount)
        external
        onlyExecutor
        returns (uint256 returnedUsdc, OmniETFTypes.ReserveSnapshot memory snapshot)
    {
        uint256 totalValue = totalValueUsdc();
        if (usdcAmount > totalValue) revert InsufficientPortfolioValue();
        if (totalValue == 0) revert InsufficientPortfolioValue();

        aaplxBalance -= (aaplxBalance * usdcAmount) / totalValue;
        tslaxBalance -= (tslaxBalance * usdcAmount) / totalValue;
        nvdaxBalance -= (nvdaxBalance * usdcAmount) / totalValue;

        returnedUsdc = usdcAmount;
        snapshot = snapshotNow();
        emit Sold(requestId, returnedUsdc, snapshot.totalValueUsdc);
    }

    function rebalance()
        external
        onlyExecutor
        returns (OmniETFTypes.ReserveSnapshot memory snapshot)
    {
        uint256 totalWad = totalValueUsdc() * OmniETFTypes.USDC_SCALE;
        aaplxBalance = _usdValueToAssetAmount(
            (totalWad * aaplxWeightBps) / OmniETFTypes.BPS, OmniETFTypes.AAPLX
        );
        tslaxBalance = _usdValueToAssetAmount(
            (totalWad * tslaxWeightBps) / OmniETFTypes.BPS, OmniETFTypes.TSLAX
        );
        nvdaxBalance = _usdValueToAssetAmount(
            (totalWad * nvdaxWeightBps) / OmniETFTypes.BPS, OmniETFTypes.NVDAX
        );
        snapshot = snapshotNow();
        emit Rebalanced(snapshot.totalValueUsdc);
    }

    function snapshotNow() public view returns (OmniETFTypes.ReserveSnapshot memory snapshot) {
        snapshot = OmniETFTypes.ReserveSnapshot({
            aaplxAmount: aaplxBalance,
            tslaxAmount: tslaxBalance,
            nvdaxAmount: nvdaxBalance,
            totalValueUsdc: totalValueUsdc(),
            timestamp: block.timestamp
        });
    }

    function totalValueUsdc() public view returns (uint256) {
        uint256 valueWad = (aaplxBalance * oracle.getPrice(OmniETFTypes.AAPLX)) / OmniETFTypes.WAD;
        valueWad += (tslaxBalance * oracle.getPrice(OmniETFTypes.TSLAX)) / OmniETFTypes.WAD;
        valueWad += (nvdaxBalance * oracle.getPrice(OmniETFTypes.NVDAX)) / OmniETFTypes.WAD;
        return valueWad / OmniETFTypes.USDC_SCALE;
    }

    function _usdValueToAssetAmount(uint256 usdValueWad, bytes32 assetId)
        internal
        view
        returns (uint256)
    {
        return (usdValueWad * OmniETFTypes.WAD) / oracle.getPrice(assetId);
    }
}
