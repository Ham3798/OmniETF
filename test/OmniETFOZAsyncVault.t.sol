// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import {
    IERC7540,
    IERC7540Deposit,
    IERC7540Redeem
} from "@openzeppelin/community-contracts/interfaces/IERC7540.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AccessManager } from "@openzeppelin/contracts/access/manager/AccessManager.sol";
import { IAccessManaged } from "@openzeppelin/contracts/access/manager/IAccessManaged.sol";
import { OmniETFOZAsyncVault } from "../contracts/OmniETFOZAsyncVault.sol";

contract OZAsyncMockUsdc {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract OZAsyncMockTokenMessengerV2 {
    address public lastCaller;
    uint256 public lastAmount;
    uint32 public lastDestinationDomain;
    bytes32 public lastMintRecipient;
    address public lastBurnToken;
    bytes32 public lastDestinationCaller;
    uint256 public lastMaxFee;
    uint32 public lastMinFinalityThreshold;

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external {
        lastCaller = msg.sender;
        lastAmount = amount;
        lastDestinationDomain = destinationDomain;
        lastMintRecipient = mintRecipient;
        lastBurnToken = burnToken;
        lastDestinationCaller = destinationCaller;
        lastMaxFee = maxFee;
        lastMinFinalityThreshold = minFinalityThreshold;
        require(
            OZAsyncMockUsdc(burnToken).transferFrom(msg.sender, address(this), amount),
            "transferFrom"
        );
    }
}

contract OmniETFOZAsyncVaultTest is Test {
    OZAsyncMockUsdc internal usdc;
    OZAsyncMockTokenMessengerV2 internal tokenMessenger;
    AccessManager internal accessManager;
    OmniETFOZAsyncVault internal vault;

    address internal user = address(0xA11CE);
    address internal operator = address(0x0FEE);
    address internal reporter = address(0xBEEF);
    uint32 internal constant SOLANA_DOMAIN = 5;
    bytes32 internal constant DESTINATION_CALLER = bytes32(0);
    uint32 internal constant MIN_FINALITY_THRESHOLD = 1000;

    function setUp() public {
        usdc = new OZAsyncMockUsdc();
        tokenMessenger = new OZAsyncMockTokenMessengerV2();
        accessManager = new AccessManager(reporter);
        vault = new OmniETFOZAsyncVault(
            IERC20(address(usdc)),
            address(tokenMessenger),
            SOLANA_DOMAIN,
            DESTINATION_CALLER,
            MIN_FINALITY_THRESHOLD,
            address(accessManager),
            reporter
        );
        _configureAccessManager();
        usdc.mint(user, 10_000_000);
        usdc.mint(reporter, 10_000_000);
    }

    function testOfficialOZBaseDepositLifecycle() public {
        uint256 requestId = _requestDeposit(1_000_000);
        bytes32 depositId = vault.depositIdByRequestId(requestId);

        assertEq(vault.totalPendingDepositAssets(), 1_000_000);
        assertEq(vault.pendingDepositRequest(requestId, user), 1_000_000);
        assertEq(vault.claimableDepositRequest(requestId, user), 0);
        assertEq(usdc.balanceOf(address(tokenMessenger)), 1_000_000);
        assertEq(tokenMessenger.lastMintRecipient(), bytes32(uint256(0xCAFE)));

        vm.prank(reporter);
        vault.markDepositSettled(depositId);
        assertEq(vault.pendingDepositRequest(requestId, user), 1_000_000);

        vm.prank(reporter);
        vault.markDepositExecuted(depositId, 999_870);
        assertEq(vault.pendingDepositRequest(requestId, user), 0);
        assertEq(vault.claimableDepositRequest(requestId, user), 1_000_000);
        assertEq(vault.maxDeposit(user), 1_000_000);
        assertEq(vault.maxMint(user), 999_870);

        vm.prank(user);
        uint256 shares = vault.deposit(1_000_000, user, user);

        assertEq(shares, 999_870);
        assertEq(vault.totalPendingDepositAssets(), 0);
        assertEq(vault.totalSupply(), 999_870);
        assertEq(vault.balanceOf(user), 999_870);
        assertEq(vault.totalAssets(), 999_870);
    }

    function testOfficialOZBaseRedeemLifecycle() public {
        _mintSharesByDeposit(1_000_000);

        vm.prank(user);
        uint256 requestId = vault.requestRedeem(250_000, user, user);
        bytes32 redeemId = vault.redeemIdByRequestId(requestId);

        assertEq(vault.balanceOf(user), 750_000);
        assertEq(vault.totalSupply(), 1_000_000);
        assertEq(vault.totalPendingRedeemShares(), 250_000);
        assertEq(vault.pendingRedeemRequest(requestId, user), 250_000);

        vm.startPrank(reporter);
        usdc.approve(address(vault), 250_000);
        vault.fundRedeemPayout(redeemId, 250_000);
        vm.stopPrank();

        assertEq(vault.maxRedeem(user), 250_000);
        assertEq(vault.maxWithdraw(user), 250_000);
        assertEq(vault.claimableRedeemRequest(requestId, user), 250_000);

        vm.prank(user);
        uint256 assets = vault.redeem(250_000, user, user);

        assertEq(assets, 250_000);
        assertEq(vault.totalPendingRedeemShares(), 0);
        assertEq(vault.totalSupply(), 750_000);
        assertEq(vault.totalAssets(), 750_000);
        assertEq(vault.reservedRedeemAssets(), 0);
    }

    function testOfficialOZBaseInterfaceAndAsyncPreviews() public {
        IERC7540(address(vault));
        assertTrue(vault.supportsInterface(type(IERC7540Deposit).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Redeem).interfaceId));
        assertTrue(vault.supportsInterface(0x2f0a18c5));
        assertEq(vault.asset(), address(usdc));
        assertEq(vault.share(), address(vault));

        vm.expectRevert(bytes4(keccak256("ERC7540AsyncDeposit()")));
        vault.previewDeposit(1);
        vm.expectRevert(bytes4(keccak256("ERC7540AsyncDeposit()")));
        vault.previewMint(1);
        vm.expectRevert(bytes4(keccak256("ERC7540AsyncRedeem()")));
        vault.previewWithdraw(1);
        vm.expectRevert(bytes4(keccak256("ERC7540AsyncRedeem()")));
        vault.previewRedeem(1);
    }

    function testOfficialOZBaseOperatorFlow() public {
        uint256 requestId = _requestDeposit(1_000_000);
        bytes32 depositId = vault.depositIdByRequestId(requestId);
        vm.prank(reporter);
        vault.markDepositSettled(depositId);
        vm.prank(reporter);
        vault.markDepositExecuted(depositId, 1_000_000);

        vm.prank(user);
        assertTrue(vault.setOperator(operator, true));

        vm.prank(operator);
        uint256 shares = vault.deposit(1_000_000, operator, user);

        assertEq(shares, 1_000_000);
        assertEq(vault.balanceOf(operator), 1_000_000);
    }

    function testOfficialOZBaseAccessManagerRestrictsOperations() public {
        uint256 requestId = _requestDeposit(1_000_000);
        bytes32 depositId = vault.depositIdByRequestId(requestId);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessManaged.AccessManagedUnauthorized.selector, user)
        );
        vault.markDepositSettled(depositId);

        vm.prank(reporter);
        vault.pause();
        assertTrue(vault.paused());

        vm.prank(reporter);
        vault.unpause();
        assertFalse(vault.paused());
    }

    function _requestDeposit(uint256 amount) internal returns (uint256 requestId) {
        vm.startPrank(user);
        vault.setDepositRoute(bytes32(uint256(0xCAFE)), 500);
        usdc.approve(address(vault), amount);
        requestId = vault.requestDeposit(amount, user, user);
        vm.stopPrank();
    }

    function _mintSharesByDeposit(uint256 amount) internal {
        uint256 requestId = _requestDeposit(amount);
        bytes32 depositId = vault.depositIdByRequestId(requestId);
        vm.prank(reporter);
        vault.markDepositSettled(depositId);
        vm.prank(reporter);
        vault.markDepositExecuted(depositId, amount);
        vm.prank(user);
        vault.deposit(amount, user, user);
    }

    function _configureAccessManager() internal {
        bytes4[] memory reporterSelectors = new bytes4[](6);
        reporterSelectors[0] = vault.markDepositSettled.selector;
        reporterSelectors[1] = vault.markDepositExecuted.selector;
        reporterSelectors[2] = vault.finalizeDeposit.selector;
        reporterSelectors[3] = vault.fundRedeemPayout.selector;
        reporterSelectors[4] = vault.markRedeemClaimable.selector;
        reporterSelectors[5] = vault.reportTotalManagedAssets.selector;

        bytes4[] memory pauserSelectors = new bytes4[](2);
        pauserSelectors[0] = vault.pause.selector;
        pauserSelectors[1] = vault.unpause.selector;

        vm.startPrank(reporter);
        accessManager.labelRole(vault.REPORTER_ROLE_ID(), "REPORTER_ROLE");
        accessManager.labelRole(vault.PAUSER_ROLE_ID(), "PAUSER_ROLE");
        accessManager.grantRole(vault.REPORTER_ROLE_ID(), reporter, 0);
        accessManager.grantRole(vault.PAUSER_ROLE_ID(), reporter, 0);
        accessManager.setTargetFunctionRole(
            address(vault), reporterSelectors, vault.REPORTER_ROLE_ID()
        );
        accessManager.setTargetFunctionRole(address(vault), pauserSelectors, vault.PAUSER_ROLE_ID());
        vm.stopPrank();
    }
}
