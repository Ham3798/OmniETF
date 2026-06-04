// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Client } from "@chainlink/contracts-ccip/libraries/Client.sol";
import { IRouterClient } from "@chainlink/contracts-ccip/interfaces/IRouterClient.sol";

contract OmniETFCCIPSender {
    error OnlyOwner();
    error InsufficientFee(uint256 requiredFee, uint256 suppliedFee);
    error RefundFailed();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AllocateSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        bytes receiver,
        uint256 fee
    );

    address public immutable ROUTER;
    address public owner;

    struct AllocateRequest {
        uint64 destinationChainSelector;
        bytes receiver;
        bytes32 tokenReceiver;
        bytes32[] accounts;
        uint64 accountIsWritableBitmap;
        uint32 computeUnits;
        uint64 aaplUnits;
        uint64 tslaUnits;
        uint64 nvdaUnits;
    }

    constructor(address router_) {
        ROUTER = router_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() private view {
        if (msg.sender != owner) revert OnlyOwner();
    }

    receive() external payable { }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
        emit OwnershipTransferred(msg.sender, newOwner);
    }

    function quoteAllocate(AllocateRequest calldata request) external view returns (uint256) {
        return IRouterClient(ROUTER).getFee(request.destinationChainSelector, _message(request));
    }

    function sendAllocate(AllocateRequest calldata request)
        external
        payable
        onlyOwner
        returns (bytes32 messageId)
    {
        Client.EVM2AnyMessage memory message = _message(request);
        uint256 fee = IRouterClient(ROUTER).getFee(request.destinationChainSelector, message);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        messageId =
            IRouterClient(ROUTER).ccipSend{ value: fee }(request.destinationChainSelector, message);

        uint256 refund = msg.value - fee;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{ value: refund }("");
            if (!ok) revert RefundFailed();
        }

        emit AllocateSent(messageId, request.destinationChainSelector, request.receiver, fee);
    }

    function _message(AllocateRequest calldata request)
        private
        pure
        returns (Client.EVM2AnyMessage memory)
    {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](0);
        return Client.EVM2AnyMessage({
            receiver: request.receiver,
            data: _allocatePayload(request.aaplUnits, request.tslaUnits, request.nvdaUnits),
            tokenAmounts: tokenAmounts,
            feeToken: address(0),
            extraArgs: Client._svmArgsToBytes(
                Client.SVMExtraArgsV1({
                    computeUnits: request.computeUnits,
                    accountIsWritableBitmap: request.accountIsWritableBitmap,
                    allowOutOfOrderExecution: true,
                    tokenReceiver: request.tokenReceiver,
                    accounts: request.accounts
                })
            )
        });
    }

    function _allocatePayload(uint64 aaplUnits, uint64 tslaUnits, uint64 nvdaUnits)
        private
        pure
        returns (bytes memory)
    {
        return bytes.concat(bytes1(uint8(1)), _le64(aaplUnits), _le64(tslaUnits), _le64(nvdaUnits));
    }

    function _le64(uint64 value) private pure returns (bytes8) {
        uint64 reversed = ((value & 0x00000000000000ff) << 56)
            | ((value & 0x000000000000ff00) << 40) | ((value & 0x0000000000ff0000) << 24)
            | ((value & 0x00000000ff000000) << 8) | ((value & 0x000000ff00000000) >> 8)
            | ((value & 0x0000ff0000000000) >> 24) | ((value & 0x00ff000000000000) >> 40)
            | ((value & 0xff00000000000000) >> 56);
        return bytes8(reversed);
    }
}
