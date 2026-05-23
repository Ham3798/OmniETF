// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { CctpDepositRouter } from "../contracts/CctpDepositRouter.sol";

contract MockUsdc {
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

contract MockTokenMessengerV2 {
    address public lastCaller;
    uint256 public lastAmount;
    uint32 public lastDestinationDomain;
    bytes32 public lastMintRecipient;
    address public lastBurnToken;
    bytes32 public lastDestinationCaller;
    uint256 public lastMaxFee;
    uint32 public lastMinFinalityThreshold;

    event MockDepositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    );

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

        require(MockUsdc(burnToken).transferFrom(msg.sender, address(this), amount), "transferFrom");

        emit MockDepositForBurn(
            amount,
            destinationDomain,
            mintRecipient,
            burnToken,
            destinationCaller,
            maxFee,
            minFinalityThreshold
        );
    }
}

contract CctpDepositRouterTest is Test {
    MockUsdc internal usdc;
    MockTokenMessengerV2 internal tokenMessenger;
    CctpDepositRouter internal router;

    address internal user = address(0xA11CE);
    uint32 internal constant SOLANA_DOMAIN = 5;
    bytes32 internal constant DESTINATION_CALLER = bytes32(0);
    uint32 internal constant MIN_FINALITY_THRESHOLD = 1000;

    function setUp() public {
        usdc = new MockUsdc();
        tokenMessenger = new MockTokenMessengerV2();
        router = new CctpDepositRouter(
            address(usdc),
            address(tokenMessenger),
            SOLANA_DOMAIN,
            DESTINATION_CALLER,
            MIN_FINALITY_THRESHOLD
        );

        usdc.mint(user, 1_000_000_000);
    }

    function testDepositTransfersUsdcAndCallsTokenMessenger() public {
        uint256 amount = 100_000_000;
        uint256 maxFee = 1_000;
        bytes32 mintRecipient = bytes32(uint256(uint160(address(0xB0B))));

        vm.prank(user);
        usdc.approve(address(router), amount);

        vm.prank(user);
        bytes32 depositId = router.deposit(amount, mintRecipient, maxFee);

        assertTrue(depositId != bytes32(0));
        assertEq(usdc.balanceOf(user), 900_000_000);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(usdc.balanceOf(address(tokenMessenger)), amount);

        assertEq(tokenMessenger.lastCaller(), address(router));
        assertEq(tokenMessenger.lastAmount(), amount);
        assertEq(tokenMessenger.lastDestinationDomain(), SOLANA_DOMAIN);
        assertEq(tokenMessenger.lastMintRecipient(), mintRecipient);
        assertEq(tokenMessenger.lastBurnToken(), address(usdc));
        assertEq(tokenMessenger.lastDestinationCaller(), DESTINATION_CALLER);
        assertEq(tokenMessenger.lastMaxFee(), maxFee);
        assertEq(tokenMessenger.lastMinFinalityThreshold(), MIN_FINALITY_THRESHOLD);
    }

    function testDepositRevertsWhenUserDidNotApproveRouter() public {
        bytes32 mintRecipient = bytes32(uint256(uint160(address(0xB0B))));

        vm.prank(user);
        vm.expectRevert(CctpDepositRouter.TokenCallFailed.selector);
        router.deposit(100_000_000, mintRecipient, 0);
    }

    function testDepositRejectsInvalidInputs() public {
        bytes32 mintRecipient = bytes32(uint256(uint160(address(0xB0B))));

        vm.expectRevert(CctpDepositRouter.AmountZero.selector);
        router.deposit(0, mintRecipient, 0);

        vm.expectRevert(CctpDepositRouter.RecipientZero.selector);
        router.deposit(1, bytes32(0), 0);

        vm.expectRevert(CctpDepositRouter.MaxFeeTooHigh.selector);
        router.deposit(100, mintRecipient, 100);
    }
}
