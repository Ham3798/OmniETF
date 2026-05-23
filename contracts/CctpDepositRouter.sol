// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;
}

/// @notice Minimal OmniETF entrypoint for initiating a Circle CCTP USDC transfer.
/// @dev This contract does not implement CCTP. It only wraps Circle's deployed TokenMessengerV2.
contract CctpDepositRouter {
    address public immutable USDC;
    ITokenMessengerV2 public immutable TOKEN_MESSENGER;
    uint32 public immutable DESTINATION_DOMAIN;
    bytes32 public immutable DESTINATION_CALLER;
    uint32 public immutable MIN_FINALITY_THRESHOLD;

    uint256 public nextDepositNonce = 1;

    event DepositStarted(
        bytes32 indexed depositId,
        address indexed user,
        uint256 amount,
        uint32 destinationDomain,
        bytes32 indexed mintRecipient,
        uint256 maxFee,
        uint32 minFinalityThreshold
    );

    error ZeroAddress();
    error AmountZero();
    error RecipientZero();
    error MaxFeeTooHigh();
    error TokenCallFailed();

    constructor(
        address usdc_,
        address tokenMessenger_,
        uint32 destinationDomain_,
        bytes32 destinationCaller_,
        uint32 minFinalityThreshold_
    ) {
        if (usdc_ == address(0) || tokenMessenger_ == address(0)) {
            revert ZeroAddress();
        }

        USDC = usdc_;
        TOKEN_MESSENGER = ITokenMessengerV2(tokenMessenger_);
        DESTINATION_DOMAIN = destinationDomain_;
        DESTINATION_CALLER = destinationCaller_;
        MIN_FINALITY_THRESHOLD = minFinalityThreshold_;
    }

    /// @notice Pulls USDC from the user and starts a CCTP burn toward the destination domain.
    /// @param amount USDC amount in base units.
    /// @param mintRecipient Destination recipient encoded as bytes32.
    /// @param maxFee Maximum destination-side fee in USDC base units.
    function deposit(uint256 amount, bytes32 mintRecipient, uint256 maxFee)
        external
        returns (bytes32 depositId)
    {
        if (amount == 0) revert AmountZero();
        if (mintRecipient == bytes32(0)) revert RecipientZero();
        if (maxFee >= amount) revert MaxFeeTooHigh();

        depositId = keccak256(
            abi.encodePacked(
                block.chainid, address(this), msg.sender, mintRecipient, amount, nextDepositNonce++
            )
        );

        _safeTransferFrom(USDC, msg.sender, address(this), amount);
        _safeApprove(USDC, address(TOKEN_MESSENGER), 0);
        _safeApprove(USDC, address(TOKEN_MESSENGER), amount);

        TOKEN_MESSENGER.depositForBurn(
            amount,
            DESTINATION_DOMAIN,
            mintRecipient,
            USDC,
            DESTINATION_CALLER,
            maxFee,
            MIN_FINALITY_THRESHOLD
        );

        emit DepositStarted(
            depositId,
            msg.sender,
            amount,
            DESTINATION_DOMAIN,
            mintRecipient,
            maxFee,
            MIN_FINALITY_THRESHOLD
        );
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(bytes4(0x23b872dd), from, to, amount));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
    }

    function _safeApprove(address token, address spender, uint256 amount) private {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(bytes4(0x095ea7b3), spender, amount));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TokenCallFailed();
    }
}
