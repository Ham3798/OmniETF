// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IBridge.sol";

/**
 * @title ETFVault
 * @notice ERC-4626 vault where shares represent ownership of a multi-chain ETF.
 *         Underlying assets are managed on Solana. NAV is reported off-chain by
 *         a trusted coordinator. Deposits bridge USDC to Solana; redeems are
 *         fulfilled asynchronously after Solana sells the portfolio.
 *
 * Flow:
 *   deposit(USDC) → mint mETF shares → bridge USDC to Solana → Solana swaps into portfolio
 *   redeem(mETF)  → burn shares → Solana sells portfolio → bridge USDC back → payout
 */
contract ETFVault is ERC4626, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ────────────────────────────────────────────────────────────────

    IBridge public bridge;
    address public navOracle;

    // Total portfolio value in USDC (6 decimals), reported from Solana.
    uint256 public reportedNAV;
    uint256 public navUpdatedAt;

    // Solana treasury PDA (32-byte pubkey)
    bytes32 public solanaTreasury;

    uint256 public depositNonce;
    uint256 public redeemNonce;

    struct PendingRedeem {
        address user;
        uint256 shares;
        uint256 usdcExpected;
        bool fulfilled;
    }

    mapping(uint256 => PendingRedeem) public pendingRedeems;

    // ─── Events ───────────────────────────────────────────────────────────────

    event DepositBridged(uint256 indexed depositId, address indexed user, uint256 usdcAmount, uint256 sharesMinted);
    event RedeemRequested(uint256 indexed redeemId, address indexed user, uint256 shares, uint256 usdcExpected);
    event RedeemFulfilled(uint256 indexed redeemId, address indexed user, uint256 usdcPaid);
    event NAVUpdated(uint256 newNAV, uint256 timestamp);
    event BridgeUpdated(address newBridge);
    event OracleUpdated(address newOracle);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error OnlyOracle();
    error OnlyBridge();
    error RedeemAlreadyFulfilled();
    error RedeemNotFound();
    error NAVStale();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        IERC20 _usdc,
        address _bridge,
        address _navOracle,
        bytes32 _solanaTreasury
    )
        ERC4626(_usdc)
        ERC20("Multi-Chain ETF", "mETF")
        Ownable(msg.sender)
    {
        bridge = IBridge(_bridge);
        navOracle = _navOracle;
        solanaTreasury = _solanaTreasury;
        reportedNAV = 0;
        navUpdatedAt = block.timestamp;
    }

    // ─── ERC-4626 Overrides ───────────────────────────────────────────────────

    /**
     * @notice Returns total portfolio value reported from Solana.
     *         On first deposit (NAV == 0) returns 0 so share price = 1:1 with USDC.
     */
    function totalAssets() public view override returns (uint256) {
        return reportedNAV;
    }

    /**
     * @notice Override: after minting shares, bridge USDC to Solana.
     *         Assets are transferred from caller → this contract by ERC4626 base.
     */
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        super._deposit(caller, receiver, assets, shares);

        uint256 depositId = ++depositNonce;

        // Approve bridge to pull USDC from this vault
        IERC20(asset()).safeIncreaseAllowance(address(bridge), assets);
        bridge.bridgeToSolana(assets, solanaTreasury, depositId);

        // NAV increases by the deposited amount (will be corrected by oracle shortly)
        reportedNAV += assets;

        emit DepositBridged(depositId, receiver, assets, shares);
    }

    /**
     * @notice Override: burn shares and register a pending redeem.
     *         USDC is NOT paid immediately — the off-chain coordinator will call
     *         fulfillRedeem() once Solana sells the assets.
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner_,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        // Burn shares from owner (allowance handled by ERC4626 base before _withdraw)
        if (caller != owner_) {
            _spendAllowance(owner_, caller, shares);
        }
        _burn(owner_, shares);

        uint256 redeemId = ++redeemNonce;

        pendingRedeems[redeemId] = PendingRedeem({
            user: receiver,
            shares: shares,
            usdcExpected: assets,
            fulfilled: false
        });

        // Decrease NAV by expected payout
        if (reportedNAV >= assets) {
            reportedNAV -= assets;
        } else {
            reportedNAV = 0;
        }

        emit RedeemRequested(redeemId, receiver, shares, assets);
    }

    // ─── Bridge Callback ─────────────────────────────────────────────────────

    /**
     * @notice Called by MockBridge after Solana sells assets and sends USDC back.
     *         Bridge transfers USDC to the user directly.
     */
    function fulfillRedeem(uint256 redeemId) external {
        if (msg.sender != address(bridge)) revert OnlyBridge();

        PendingRedeem storage pr = pendingRedeems[redeemId];
        if (pr.user == address(0)) revert RedeemNotFound();
        if (pr.fulfilled) revert RedeemAlreadyFulfilled();

        pr.fulfilled = true;

        emit RedeemFulfilled(redeemId, pr.user, pr.usdcExpected);
    }

    // ─── NAV Update ──────────────────────────────────────────────────────────

    /**
     * @notice Called by the trusted NAV oracle (off-chain coordinator via MockNavOracle).
     */
    function updateNAV(uint256 newNav) external {
        if (msg.sender != navOracle) revert OnlyOracle();
        reportedNAV = newNav;
        navUpdatedAt = block.timestamp;
        emit NAVUpdated(newNav, block.timestamp);
    }

    // ─── View Helpers ─────────────────────────────────────────────────────────

    function getPendingRedeem(uint256 redeemId) external view returns (PendingRedeem memory) {
        return pendingRedeems[redeemId];
    }

    /// NAV per share in USDC (6 decimals). Returns 0 if no shares minted.
    function navPerShare() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e6; // 1 USDC = 1 share on first deposit
        return (reportedNAV * 1e18) / supply;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setBridge(address _bridge) external onlyOwner {
        bridge = IBridge(_bridge);
        emit BridgeUpdated(_bridge);
    }

    function setNavOracle(address _oracle) external onlyOwner {
        navOracle = _oracle;
        emit OracleUpdated(_oracle);
    }

    function setSolanaTreasury(bytes32 _treasury) external onlyOwner {
        solanaTreasury = _treasury;
    }
}
