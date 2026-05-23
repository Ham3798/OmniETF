// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

contract AsyncMockUsdc {
    string public constant name = "Mock USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
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

contract AsyncMockTokenMessengerV2 {
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

        require(AsyncMockUsdc(burnToken).transferFrom(msg.sender, address(this), amount), "transferFrom");
    }
}

contract OmniETFAsyncVaultTest is Test {
    AsyncMockUsdc internal usdc;
    AsyncMockTokenMessengerV2 internal tokenMessenger;
    OmniETFAsyncVault internal vault;

    address internal user = address(0xA11CE);
    address internal reporter = address(0xBEEF);
    uint32 internal constant SOLANA_DOMAIN = 5;
    bytes32 internal constant DESTINATION_CALLER = bytes32(0);
    uint32 internal constant MIN_FINALITY_THRESHOLD = 1000;

    function setUp() public {
        usdc = new AsyncMockUsdc();
        tokenMessenger = new AsyncMockTokenMessengerV2();
        vault = new OmniETFAsyncVault(
            address(usdc),
            address(tokenMessenger),
            SOLANA_DOMAIN,
            DESTINATION_CALLER,
            MIN_FINALITY_THRESHOLD,
            reporter
        );
        usdc.mint(user, 10_000_000);
    }

    function testRequestDepositStartsCctpButDoesNotMintShares() public {
        bytes32 solanaAccount = bytes32(uint256(0xCAFE));

        vm.startPrank(user);
        usdc.approve(address(vault), 1_000_000);
        bytes32 depositId = vault.requestDeposit(1_000_000, solanaAccount, 500);
        vm.stopPrank();

        assertEq(vault.totalSupply(), 0);
        assertEq(vault.balanceOf(user), 0);
        assertEq(usdc.balanceOf(address(tokenMessenger)), 1_000_000);
        assertEq(tokenMessenger.lastCaller(), address(vault));
        assertEq(tokenMessenger.lastAmount(), 1_000_000);
        assertEq(tokenMessenger.lastMintRecipient(), solanaAccount);

        (
            address recordedUser,
            uint256 requestedAssets,
            bytes32 recordedAccount,
            uint256 maxFee,
            uint256 executedAssets,
            uint256 sharesMinted,
            OmniETFAsyncVault.DepositState state
        ) = vault.deposits(depositId);

        assertEq(recordedUser, user);
        assertEq(requestedAssets, 1_000_000);
        assertEq(recordedAccount, solanaAccount);
        assertEq(maxFee, 500);
        assertEq(executedAssets, 0);
        assertEq(sharesMinted, 0);
        assertEq(uint256(state), uint256(OmniETFAsyncVault.DepositState.Requested));
    }

    function testFinalizeDepositMintsFromExecutedValue() public {
        bytes32 depositId = _request(1_000_000);
        _settleAndExecute(depositId, 999_870);

        vm.prank(reporter);
        uint256 shares = vault.finalizeDeposit(depositId, 0);

        assertEq(shares, 999_870);
        assertEq(vault.totalSupply(), 999_870);
        assertEq(vault.balanceOf(user), 999_870);
        assertEq(vault.totalManagedAssets(), 999_870);
        assertEq(vault.nav(), 1_000_000);
    }

    function testFinalizeDepositUsesNavBeforeDeposit() public {
        bytes32 firstDepositId = _request(1_000_000);
        _settleAndExecute(firstDepositId, 1_000_000);
        vm.prank(reporter);
        vault.finalizeDeposit(firstDepositId, 0);

        vm.prank(reporter);
        vault.reportTotalManagedAssets(2_000_000);

        bytes32 secondDepositId = _request(1_000_000);
        _settleAndExecute(secondDepositId, 1_000_000);
        vm.prank(reporter);
        uint256 shares = vault.finalizeDeposit(secondDepositId, 0);

        assertEq(shares, 500_000);
        assertEq(vault.balanceOf(user), 1_500_000);
        assertEq(vault.totalSupply(), 1_500_000);
        assertEq(vault.totalManagedAssets(), 3_000_000);
        assertEq(vault.nav(), 2_000_000);
    }

    function testFinalizeRejectsInvalidReporterAndDepositState() public {
        bytes32 depositId = _request(1_000_000);

        vm.expectRevert(OmniETFAsyncVault.NotReporter.selector);
        vault.finalizeDeposit(depositId, 1_000_000);

        vm.prank(reporter);
        vm.expectRevert(OmniETFAsyncVault.AmountZero.selector);
        vault.finalizeDeposit(depositId, 0);

        vm.prank(reporter);
        vault.finalizeDeposit(depositId, 1_000_000);

        vm.prank(reporter);
        vm.expectRevert(OmniETFAsyncVault.DepositAlreadyFinalized.selector);
        vault.finalizeDeposit(depositId, 0);

        vm.prank(reporter);
        vm.expectRevert(OmniETFAsyncVault.UnknownDeposit.selector);
        vault.finalizeDeposit(bytes32(uint256(0xBAD)), 1_000_000);
    }

    function testReporterCanRecordSettledAndExecutedStatesBeforeFinalize() public {
        bytes32 depositId = _request(1_000_000);

        vm.prank(reporter);
        vault.markDepositSettled(depositId);

        (
            ,
            ,
            ,
            ,
            uint256 executedAssetsBefore,
            ,
            OmniETFAsyncVault.DepositState settledState
        ) = vault.deposits(depositId);
        assertEq(executedAssetsBefore, 0);
        assertEq(uint256(settledState), uint256(OmniETFAsyncVault.DepositState.Settled));

        vm.prank(reporter);
        vm.expectRevert(OmniETFAsyncVault.AmountZero.selector);
        vault.markDepositExecuted(depositId, 0);

        vm.prank(reporter);
        vault.markDepositExecuted(depositId, 900_000);

        (
            ,
            ,
            ,
            ,
            uint256 executedAssetsAfter,
            ,
            OmniETFAsyncVault.DepositState executedState
        ) = vault.deposits(depositId);
        assertEq(executedAssetsAfter, 900_000);
        assertEq(uint256(executedState), uint256(OmniETFAsyncVault.DepositState.Executed));

        vm.prank(reporter);
        uint256 shares = vault.finalizeDeposit(depositId, 0);
        assertEq(shares, 900_000);
    }

    function testRequestRedeemBurnsSharesAndRecordsQuote() public {
        bytes32 depositId = _request(1_000_000);
        _settleAndExecute(depositId, 1_000_000);
        vm.prank(reporter);
        vault.finalizeDeposit(depositId, 0);

        vm.prank(user);
        bytes32 redeemId = vault.requestRedeem(250_000);

        assertEq(vault.balanceOf(user), 750_000);
        assertEq(vault.totalSupply(), 750_000);
        assertEq(vault.totalManagedAssets(), 750_000);

        (
            address recordedUser,
            uint256 sharesBurned,
            uint256 assetsQuoted,
            OmniETFAsyncVault.RedeemState state
        ) = vault.redeems(redeemId);

        assertEq(recordedUser, user);
        assertEq(sharesBurned, 250_000);
        assertEq(assetsQuoted, 250_000);
        assertEq(uint256(state), uint256(OmniETFAsyncVault.RedeemState.Requested));
    }

    function testRequestRejectsInvalidInputs() public {
        bytes32 solanaAccount = bytes32(uint256(0xCAFE));

        vm.expectRevert(OmniETFAsyncVault.AmountZero.selector);
        vault.requestDeposit(0, solanaAccount, 0);

        vm.expectRevert(OmniETFAsyncVault.RecipientZero.selector);
        vault.requestDeposit(1, bytes32(0), 0);

        vm.expectRevert(OmniETFAsyncVault.MaxFeeTooHigh.selector);
        vault.requestDeposit(100, solanaAccount, 100);
    }

    function _request(uint256 amount) internal returns (bytes32 depositId) {
        bytes32 solanaAccount = bytes32(uint256(0xCAFE));
        vm.startPrank(user);
        usdc.approve(address(vault), amount);
        depositId = vault.requestDeposit(amount, solanaAccount, 500);
        vm.stopPrank();
    }

    function _settleAndExecute(bytes32 depositId, uint256 executedAssets) internal {
        vm.prank(reporter);
        vault.markDepositSettled(depositId);
        vm.prank(reporter);
        vault.markDepositExecuted(depositId, executedAssets);
    }
}
