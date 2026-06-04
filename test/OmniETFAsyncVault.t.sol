// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import {
    IERC7540,
    IERC7540Deposit,
    IERC7540Operator,
    IERC7540Redeem
} from "forge-std/interfaces/IERC7540.sol";
import { IERC7575 } from "forge-std/interfaces/IERC7575.sol";
import { OmniETFAsyncVault } from "../contracts/OmniETFAsyncVault.sol";

contract AsyncMockUsdc {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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

        require(
            AsyncMockUsdc(burnToken).transferFrom(msg.sender, address(this), amount), "transferFrom"
        );
    }
}

contract OmniETFAsyncVaultTest is Test {
    AsyncMockUsdc internal usdc;
    AsyncMockTokenMessengerV2 internal tokenMessenger;
    OmniETFAsyncVault internal vault;

    address internal user = address(0xA11CE);
    address internal operator = address(0x0FEE);
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
        usdc.mint(reporter, 10_000_000);
    }

    function testRequestDepositUsesStandardErc7540EntryPoint() public {
        bytes32 solanaAccount = bytes32(uint256(0xCAFE));

        vm.startPrank(user);
        vault.setDepositRoute(solanaAccount, 500);
        usdc.approve(address(vault), 1_000_000);
        uint256 requestId = vault.requestDeposit(1_000_000, user, user);
        vm.stopPrank();

        bytes32 depositId = vault.depositIdByRequestId(requestId);
        assertEq(vault.totalSupply(), 0);
        assertEq(vault.balanceOf(user), 0);
        assertEq(usdc.balanceOf(address(tokenMessenger)), 1_000_000);
        assertEq(tokenMessenger.lastCaller(), address(vault));
        assertEq(tokenMessenger.lastMintRecipient(), solanaAccount);

        (
            address controller,
            address owner,
            uint256 requestedAssets,
            uint256 claimableAssets,
            uint256 claimedAssets,
            bytes32 recordedAccount,
            uint256 maxFee,
            uint256 recordedRequestId,
            OmniETFAsyncVault.DepositState state
        ) = vault.deposits(depositId);

        assertEq(controller, user);
        assertEq(owner, user);
        assertEq(requestedAssets, 1_000_000);
        assertEq(claimableAssets, 0);
        assertEq(claimedAssets, 0);
        assertEq(recordedAccount, solanaAccount);
        assertEq(maxFee, 500);
        assertEq(recordedRequestId, requestId);
        assertEq(vault.depositRequestIdById(depositId), requestId);
        assertEq(vault.pendingDepositRequest(requestId, user), 1_000_000);
        assertEq(vault.claimableDepositRequest(requestId, user), 0);
        assertEq(uint256(state), uint256(OmniETFAsyncVault.DepositState.Pending));
    }

    function testClaimableDepositIsClaimedThroughStandardDeposit() public {
        uint256 requestId = _request(1_000_000);
        bytes32 depositId = vault.depositIdByRequestId(requestId);
        _settleAndExecute(depositId, 999_870);

        assertEq(vault.pendingDepositRequest(requestId, user), 0);
        assertEq(vault.claimableDepositRequest(requestId, user), 999_870);

        vm.prank(user);
        uint256 shares = vault.deposit(999_870, user, user);

        assertEq(shares, 999_870);
        assertEq(vault.totalSupply(), 999_870);
        assertEq(vault.balanceOf(user), 999_870);
        assertEq(vault.totalManagedAssets(), 999_870);
        assertEq(vault.claimableDepositRequest(requestId, user), 0);
        assertEq(vault.nav(), 1_000_000);
    }

    function testFinalizeDepositShortcutStillClaimsExecutedValue() public {
        uint256 requestId = _request(1_000_000);
        bytes32 depositId = vault.depositIdByRequestId(requestId);
        _settleAndExecute(depositId, 999_870);

        vm.prank(reporter);
        uint256 shares = vault.finalizeDeposit(depositId, 0);

        assertEq(shares, 999_870);
        assertEq(vault.totalSupply(), 999_870);
        assertEq(vault.balanceOf(user), 999_870);
        assertEq(vault.totalManagedAssets(), 999_870);
    }

    function testDepositClaimUsesNavBeforeClaim() public {
        uint256 firstRequestId = _request(1_000_000);
        bytes32 firstDepositId = vault.depositIdByRequestId(firstRequestId);
        _settleAndExecute(firstDepositId, 1_000_000);
        vm.prank(user);
        vault.deposit(1_000_000, user, user);

        vm.prank(reporter);
        vault.reportTotalManagedAssets(2_000_000);

        uint256 secondRequestId = _request(1_000_000);
        bytes32 secondDepositId = vault.depositIdByRequestId(secondRequestId);
        _settleAndExecute(secondDepositId, 1_000_000);
        vm.prank(user);
        uint256 shares = vault.deposit(1_000_000, user, user);

        assertEq(shares, 500_000);
        assertEq(vault.balanceOf(user), 1_500_000);
        assertEq(vault.totalSupply(), 1_500_000);
        assertEq(vault.totalManagedAssets(), 3_000_000);
        assertEq(vault.nav(), 2_000_000);
    }

    function testMintClaimsExactRequestedSharesWhenRoundingWouldOverMint() public {
        _mintSharesByDeposit(10_000);

        vm.prank(reporter);
        vault.reportTotalManagedAssets(6_000);

        uint256 requestId = _request(1_202);
        bytes32 depositId = vault.depositIdByRequestId(requestId);
        _settleAndExecute(depositId, 1_202);

        vm.prank(user);
        uint256 assets = vault.mint(2_002, user, user);

        assertEq(assets, 1_202);
        assertEq(vault.balanceOf(user), 12_002);
        assertEq(vault.totalSupply(), 12_002);
        assertEq(vault.totalManagedAssets(), 7_202);
        assertEq(vault.claimableDepositRequest(requestId, user), 0);
    }

    function testOperatorCanRequestAndClaimForController() public {
        bytes32 solanaAccount = bytes32(uint256(0xCAFE));

        vm.startPrank(user);
        vault.setDepositRoute(solanaAccount, 500);
        assertTrue(vault.setOperator(operator, true));
        usdc.approve(address(vault), 1_000_000);
        vm.stopPrank();

        vm.prank(operator);
        uint256 requestId = vault.requestDeposit(1_000_000, user, user);
        bytes32 depositId = vault.depositIdByRequestId(requestId);
        _settleAndExecute(depositId, 1_000_000);

        vm.prank(operator);
        uint256 shares = vault.deposit(1_000_000, user, user);

        assertEq(shares, 1_000_000);
        assertEq(vault.balanceOf(user), 1_000_000);
    }

    function testOperatorRevocationRemovesStandardControllerAccess() public {
        uint256 requestId = _request(1_000_000);
        bytes32 depositId = vault.depositIdByRequestId(requestId);
        _settleAndExecute(depositId, 1_000_000);

        vm.startPrank(user);
        assertTrue(vault.setOperator(operator, true));
        assertTrue(vault.isOperator(user, operator));
        assertTrue(vault.setOperator(operator, false));
        assertFalse(vault.isOperator(user, operator));
        vm.stopPrank();

        vm.prank(operator);
        vm.expectRevert(OmniETFAsyncVault.NotAuthorized.selector);
        vault.deposit(1_000_000, operator, user);

        assertEq(vault.claimableDepositRequest(requestId, user), 1_000_000);
    }

    function testErc20AllowanceAloneDoesNotAuthorizeDepositRequestOwner() public {
        bytes32 solanaAccount = bytes32(uint256(0xCAFE));

        vm.startPrank(user);
        vault.setDepositRoute(solanaAccount, 500);
        usdc.approve(address(vault), 1_000_000);
        usdc.approve(operator, 1_000_000);
        vm.stopPrank();

        vm.prank(operator);
        vm.expectRevert(OmniETFAsyncVault.NotAuthorized.selector);
        vault.requestDeposit(1_000_000, user, user);
    }

    function testLifecycleRunsThroughIerc7540Type() public {
        IERC7540 erc7540Vault = IERC7540(address(vault));
        bytes32 solanaAccount = bytes32(uint256(0xCAFE));

        vm.startPrank(user);
        vault.setDepositRoute(solanaAccount, 500);
        usdc.approve(address(vault), 1_000_000);
        uint256 depositRequestId = erc7540Vault.requestDeposit(1_000_000, user, user);
        vm.stopPrank();

        bytes32 depositId = vault.depositIdByRequestId(depositRequestId);
        _settleAndExecute(depositId, 1_000_000);

        vm.prank(user);
        uint256 shares = erc7540Vault.deposit(1_000_000, user, user);
        assertEq(shares, 1_000_000);

        vm.prank(user);
        uint256 redeemRequestId = erc7540Vault.requestRedeem(250_000, user, user);
        bytes32 redeemId = vault.redeemIdByRequestId(redeemRequestId);

        vm.startPrank(reporter);
        usdc.approve(address(vault), 250_000);
        vault.fundRedeemPayout(redeemId, 250_000);
        vm.stopPrank();

        assertEq(vault.reservedRedeemAssets(), 250_000);
        assertEq(vault.availableRedeemPayoutAssets(), 0);
        assertEq(erc7540Vault.claimableRedeemRequest(redeemRequestId, user), 250_000);

        vm.prank(user);
        uint256 assets = erc7540Vault.redeem(250_000, user, user);
        assertEq(assets, 250_000);
        assertEq(vault.reservedRedeemAssets(), 0);
    }

    function testErc7575ViewsAndLimitsUseClaimableAsyncBalances() public {
        uint256 requestId = _request(1_000_000);
        bytes32 depositId = vault.depositIdByRequestId(requestId);

        assertEq(vault.asset(), address(usdc));
        assertEq(vault.share(), address(vault));
        assertEq(vault.totalAssets(), 0);
        assertEq(vault.maxDeposit(user), 0);
        assertEq(vault.maxMint(user), 0);

        _settleAndExecute(depositId, 1_000_000);

        assertEq(vault.pendingDepositRequest(requestId, user), 0);
        assertEq(vault.claimableDepositRequest(requestId, user), 1_000_000);
        assertEq(vault.maxDeposit(user), 1_000_000);
        assertEq(vault.maxMint(user), 1_000_000);

        vm.prank(user);
        vault.deposit(1_000_000, user, user);

        assertEq(vault.totalAssets(), 1_000_000);
        assertEq(vault.convertToShares(500_000), 500_000);
        assertEq(vault.convertToAssets(500_000), 500_000);

        vm.prank(user);
        uint256 redeemRequestId = vault.requestRedeem(400_000, user, user);
        bytes32 redeemId = vault.redeemIdByRequestId(redeemRequestId);

        assertEq(vault.maxWithdraw(user), 0);
        assertEq(vault.maxRedeem(user), 0);

        vm.startPrank(reporter);
        usdc.approve(address(vault), 400_000);
        vault.fundRedeemPayout(redeemId, 400_000);
        vm.stopPrank();

        assertEq(vault.maxWithdraw(user), 400_000);
        assertEq(vault.maxRedeem(user), 400_000);
    }

    function testAsyncPreviewFunctionsRevertPerErc7540() public {
        vm.expectRevert(OmniETFAsyncVault.AsyncPreviewUnavailable.selector);
        vault.previewDeposit(1);

        vm.expectRevert(OmniETFAsyncVault.AsyncPreviewUnavailable.selector);
        vault.previewMint(1);

        vm.expectRevert(OmniETFAsyncVault.AsyncPreviewUnavailable.selector);
        vault.previewWithdraw(1);

        vm.expectRevert(OmniETFAsyncVault.AsyncPreviewUnavailable.selector);
        vault.previewRedeem(1);
    }

    function testRedeemLifecycleCompletesThroughStandardRedeemWithPayout() public {
        _mintSharesByDeposit(1_000_000);

        vm.prank(user);
        uint256 requestId = vault.requestRedeem(250_000, user, user);
        bytes32 redeemId = vault.redeemIdByRequestId(requestId);

        assertEq(vault.balanceOf(user), 750_000);
        assertEq(vault.balanceOf(address(vault)), 250_000);
        assertEq(vault.totalSupply(), 1_000_000);
        assertEq(vault.pendingRedeemRequest(requestId, user), 250_000);

        vm.startPrank(reporter);
        usdc.approve(address(vault), 250_000);
        vault.fundRedeemPayout(redeemId, 250_000);
        vm.stopPrank();

        assertEq(vault.reservedRedeemAssets(), 250_000);
        assertEq(vault.pendingRedeemRequest(requestId, user), 0);
        assertEq(vault.claimableRedeemRequest(requestId, user), 250_000);

        vm.prank(user);
        uint256 assets = vault.redeem(250_000, user, user);

        assertEq(assets, 250_000);
        assertEq(vault.totalSupply(), 750_000);
        assertEq(vault.balanceOf(user), 750_000);
        assertEq(usdc.balanceOf(user), 9_250_000);
        assertEq(usdc.balanceOf(reporter), 9_750_000);
        assertEq(vault.totalManagedAssets(), 750_000);
        assertEq(vault.reservedRedeemAssets(), 0);
        assertEq(vault.claimableRedeemRequest(requestId, user), 0);
    }

    function testDirectReverseCctpMintToVaultCanMarkRedeemClaimable() public {
        _mintSharesByDeposit(1_000_000);

        vm.prank(user);
        uint256 requestId = vault.requestRedeem(250_000, user, user);
        bytes32 redeemId = vault.redeemIdByRequestId(requestId);

        usdc.mint(address(vault), 250_000);
        assertEq(vault.availableRedeemPayoutAssets(), 250_000);

        vm.prank(reporter);
        vault.markRedeemClaimable(redeemId, 250_000);

        assertEq(vault.pendingRedeemRequest(requestId, user), 0);
        assertEq(vault.claimableRedeemRequest(requestId, user), 250_000);
        assertEq(vault.reservedRedeemAssets(), 250_000);
        assertEq(vault.availableRedeemPayoutAssets(), 0);

        vm.prank(user);
        uint256 assets = vault.redeem(250_000, user, user);

        assertEq(assets, 250_000);
        assertEq(vault.reservedRedeemAssets(), 0);
        assertEq(usdc.balanceOf(user), 9_250_000);
    }

    function testRedeemClaimableRequiresFundedVaultBalance() public {
        _mintSharesByDeposit(1_000_000);

        vm.prank(user);
        uint256 requestId = vault.requestRedeem(250_000, user, user);
        bytes32 redeemId = vault.redeemIdByRequestId(requestId);

        vm.prank(reporter);
        vm.expectRevert(OmniETFAsyncVault.InsufficientPayoutAssets.selector);
        vault.markRedeemClaimable(redeemId, 250_000);

        assertEq(vault.pendingRedeemRequest(requestId, user), 250_000);
        assertEq(vault.reservedRedeemAssets(), 0);
    }

    function testRedeemPayoutReservePreventsDoubleMarkingSameVaultBalance() public {
        _mintSharesByDeposit(1_000_000);

        vm.prank(user);
        uint256 firstRequestId = vault.requestRedeem(250_000, user, user);
        bytes32 firstRedeemId = vault.redeemIdByRequestId(firstRequestId);

        vm.prank(user);
        uint256 secondRequestId = vault.requestRedeem(250_000, user, user);
        bytes32 secondRedeemId = vault.redeemIdByRequestId(secondRequestId);

        usdc.mint(address(vault), 250_000);

        vm.prank(reporter);
        vault.markRedeemClaimable(firstRedeemId, 250_000);

        vm.prank(reporter);
        vm.expectRevert(OmniETFAsyncVault.InsufficientPayoutAssets.selector);
        vault.markRedeemClaimable(secondRedeemId, 250_000);

        assertEq(vault.claimableRedeemRequest(firstRequestId, user), 250_000);
        assertEq(vault.pendingRedeemRequest(secondRequestId, user), 250_000);
        assertEq(vault.reservedRedeemAssets(), 250_000);
    }

    function testWithdrawClaimsExactAssetsFromFundedRedeemRequest() public {
        _mintSharesByDeposit(1_000_000);

        vm.prank(user);
        uint256 requestId = vault.requestRedeem(250_000, user, user);
        bytes32 redeemId = vault.redeemIdByRequestId(requestId);

        vm.startPrank(reporter);
        usdc.approve(address(vault), 250_000);
        vault.fundRedeemPayout(redeemId, 250_000);
        vm.stopPrank();

        vm.prank(user);
        uint256 shares = vault.withdraw(100_000, user, user);

        assertEq(shares, 100_000);
        assertEq(vault.reservedRedeemAssets(), 150_000);
        assertEq(vault.totalSupply(), 900_000);
        assertEq(vault.balanceOf(user), 750_000);
        assertEq(usdc.balanceOf(user), 9_100_000);
        assertEq(vault.claimableRedeemRequest(requestId, user), 150_000);

        vm.prank(user);
        uint256 assets = vault.redeem(150_000, user, user);
        assertEq(assets, 150_000);
        assertEq(vault.totalSupply(), 750_000);
        assertEq(vault.reservedRedeemAssets(), 0);
        assertEq(vault.claimableRedeemRequest(requestId, user), 0);
    }

    function testBackwardCompatibleRedeemClaimHelper() public {
        _mintSharesByDeposit(1_000_000);

        vm.prank(user);
        bytes32 redeemId = vault.requestRedeem(250_000);

        vm.startPrank(reporter);
        usdc.approve(address(vault), 250_000);
        vault.fundRedeemPayout(redeemId, 250_000);
        vm.stopPrank();

        vm.prank(user);
        uint256 assets = vault.claimRedeem(redeemId);

        assertEq(assets, 250_000);
        assertEq(vault.totalSupply(), 750_000);
        assertEq(vault.totalManagedAssets(), 750_000);
    }

    function testRejectsInvalidActorsAndStates() public {
        vm.prank(user);
        vm.expectRevert(OmniETFAsyncVault.RouteNotConfigured.selector);
        vault.requestDeposit(1, user, user);

        uint256 requestId = _request(1_000_000);
        bytes32 depositId = vault.depositIdByRequestId(requestId);

        vm.expectRevert(OmniETFAsyncVault.NotReporter.selector);
        vault.markDepositSettled(depositId);

        vm.prank(reporter);
        vm.expectRevert(OmniETFAsyncVault.InvalidDepositState.selector);
        vault.markDepositExecuted(depositId, 1_000_000);

        vm.prank(reporter);
        vault.markDepositSettled(depositId);

        vm.prank(reporter);
        vm.expectRevert(OmniETFAsyncVault.AmountZero.selector);
        vault.markDepositExecuted(depositId, 0);
    }

    function testErc165Reports7540And7575() public view {
        assertTrue(vault.supportsInterface(type(IERC7540).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Deposit).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Redeem).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7540Operator).interfaceId));
        assertTrue(vault.supportsInterface(type(IERC7575).interfaceId));
    }

    function testOpenZeppelinRoleModelControlsReporterAndPause() public {
        bytes32 reporterRole = vault.REPORTER_ROLE();
        bytes32 pauserRole = vault.PAUSER_ROLE();

        assertTrue(vault.hasRole(reporterRole, reporter));
        assertTrue(vault.hasRole(pauserRole, reporter));

        address newReporter = address(0xF00D);
        vm.prank(reporter);
        vault.setReporter(newReporter);

        assertFalse(vault.hasRole(reporterRole, reporter));
        assertTrue(vault.hasRole(reporterRole, newReporter));
        assertTrue(vault.hasRole(pauserRole, newReporter));

        vm.prank(newReporter);
        vault.pause();
        assertTrue(vault.paused());

        vm.prank(newReporter);
        vault.unpause();
        assertFalse(vault.paused());
    }

    function _request(uint256 amount) internal returns (uint256 requestId) {
        bytes32 solanaAccount = bytes32(uint256(0xCAFE));
        vm.startPrank(user);
        vault.setDepositRoute(solanaAccount, 500);
        usdc.approve(address(vault), amount);
        requestId = vault.requestDeposit(amount, user, user);
        vm.stopPrank();
    }

    function _mintSharesByDeposit(uint256 amount) internal {
        uint256 requestId = _request(amount);
        bytes32 depositId = vault.depositIdByRequestId(requestId);
        _settleAndExecute(depositId, amount);
        vm.prank(user);
        vault.deposit(amount, user, user);
    }

    function _settleAndExecute(bytes32 depositId, uint256 executedAssets) internal {
        vm.prank(reporter);
        vault.markDepositSettled(depositId);
        vm.prank(reporter);
        vault.markDepositExecuted(depositId, executedAssets);
    }
}
