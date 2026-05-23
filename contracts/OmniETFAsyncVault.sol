// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICircleTokenMessengerV2 {
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

/// @notice ERC-7540-style async deposit vault for the OmniETF PoC.
/// @dev mETF is minted only after Solana execution is reported back to Base.
contract OmniETFAsyncVault {
    string public constant name = "OmniETF Share";
    string public constant symbol = "mETF";
    uint8 public constant decimals = 6;

    enum DepositState {
        None,
        Requested,
        Settled,
        Executed,
        Finalized
    }

    enum RedeemState {
        None,
        Requested
    }

    struct DepositRequest {
        address user;
        uint256 requestedAssets;
        bytes32 solanaUsdcTokenAccount;
        uint256 maxFee;
        uint256 executedAssets;
        uint256 sharesMinted;
        DepositState state;
    }

    struct RedeemRequest {
        address user;
        uint256 sharesBurned;
        uint256 assetsQuoted;
        RedeemState state;
    }

    address public immutable USDC;
    ICircleTokenMessengerV2 public immutable TOKEN_MESSENGER;
    uint32 public immutable DESTINATION_DOMAIN;
    bytes32 public immutable DESTINATION_CALLER;
    uint32 public immutable MIN_FINALITY_THRESHOLD;

    address public reporter;
    uint256 public totalSupply;
    uint256 public totalManagedAssets;
    uint256 public nextDepositNonce = 1;
    uint256 public nextRedeemNonce = 1;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(bytes32 => DepositRequest) public deposits;
    mapping(bytes32 => RedeemRequest) public redeems;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event ReporterUpdated(address indexed oldReporter, address indexed newReporter);
    event TotalManagedAssetsReported(uint256 oldTotalAssets, uint256 newTotalAssets);
    event DepositRequested(
        bytes32 indexed depositId,
        address indexed user,
        uint256 amount,
        bytes32 indexed solanaUsdcTokenAccount,
        uint256 maxFee
    );
    event DepositSettled(bytes32 indexed depositId);
    event DepositExecuted(bytes32 indexed depositId, uint256 executedAssets);
    event DepositFinalized(
        bytes32 indexed depositId,
        address indexed user,
        uint256 executedAssets,
        uint256 sharesMinted,
        uint256 navBefore
    );
    event RedeemRequested(
        bytes32 indexed redeemId,
        address indexed user,
        uint256 sharesBurned,
        uint256 assetsQuoted
    );

    error ZeroAddress();
    error AmountZero();
    error RecipientZero();
    error MaxFeeTooHigh();
    error TokenCallFailed();
    error NotReporter();
    error UnknownDeposit();
    error DepositNotRequested();
    error DepositNotSettled();
    error DepositNotExecutable();
    error DepositAlreadyFinalized();
    error SharesZero();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(
        address usdc_,
        address tokenMessenger_,
        uint32 destinationDomain_,
        bytes32 destinationCaller_,
        uint32 minFinalityThreshold_,
        address reporter_
    ) {
        if (usdc_ == address(0) || tokenMessenger_ == address(0) || reporter_ == address(0)) {
            revert ZeroAddress();
        }

        USDC = usdc_;
        TOKEN_MESSENGER = ICircleTokenMessengerV2(tokenMessenger_);
        DESTINATION_DOMAIN = destinationDomain_;
        DESTINATION_CALLER = destinationCaller_;
        MIN_FINALITY_THRESHOLD = minFinalityThreshold_;
        reporter = reporter_;
    }

    modifier onlyReporter() {
        _onlyReporter();
        _;
    }

    function _onlyReporter() internal view {
        if (msg.sender != reporter) revert NotReporter();
    }

    /// @notice Starts a cross-chain deposit request. This does not mint mETF yet.
    function requestDeposit(uint256 amount, bytes32 solanaUsdcTokenAccount, uint256 maxFee)
        external
        returns (bytes32 depositId)
    {
        if (amount == 0) revert AmountZero();
        if (solanaUsdcTokenAccount == bytes32(0)) revert RecipientZero();
        if (maxFee >= amount) revert MaxFeeTooHigh();

        depositId = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                msg.sender,
                solanaUsdcTokenAccount,
                amount,
                nextDepositNonce++
            )
        );

        deposits[depositId] = DepositRequest({
            user: msg.sender,
            requestedAssets: amount,
            solanaUsdcTokenAccount: solanaUsdcTokenAccount,
            maxFee: maxFee,
            executedAssets: 0,
            sharesMinted: 0,
            state: DepositState.Requested
        });

        _safeTransferFrom(USDC, msg.sender, address(this), amount);
        _safeApprove(USDC, address(TOKEN_MESSENGER), 0);
        _safeApprove(USDC, address(TOKEN_MESSENGER), amount);

        TOKEN_MESSENGER.depositForBurn(
            amount,
            DESTINATION_DOMAIN,
            solanaUsdcTokenAccount,
            USDC,
            DESTINATION_CALLER,
            maxFee,
            MIN_FINALITY_THRESHOLD
        );

        emit DepositRequested(depositId, msg.sender, amount, solanaUsdcTokenAccount, maxFee);
    }

    /// @notice Marks a CCTP transfer as settled on Solana. No mETF is minted yet.
    function markDepositSettled(bytes32 depositId) external onlyReporter {
        DepositRequest storage request = _knownDeposit(depositId);
        if (request.state == DepositState.Finalized) revert DepositAlreadyFinalized();
        if (request.state != DepositState.Requested) revert DepositNotRequested();

        request.state = DepositState.Settled;
        emit DepositSettled(depositId);
    }

    /// @notice Records Solana basket execution value. No mETF is minted yet.
    function markDepositExecuted(bytes32 depositId, uint256 executedAssets) external onlyReporter {
        if (executedAssets == 0) revert AmountZero();
        DepositRequest storage request = _knownDeposit(depositId);
        if (request.state == DepositState.Finalized) revert DepositAlreadyFinalized();
        if (request.state != DepositState.Settled) revert DepositNotSettled();

        request.executedAssets = executedAssets;
        request.state = DepositState.Executed;
        emit DepositExecuted(depositId, executedAssets);
    }

    /// @notice Finalizes a Solana execution report and mints mETF from executed value.
    function finalizeDeposit(bytes32 depositId, uint256 executedAssets)
        external
        onlyReporter
        returns (uint256 sharesMinted)
    {
        DepositRequest storage request = _knownDeposit(depositId);
        if (request.state == DepositState.Finalized) revert DepositAlreadyFinalized();
        if (request.state == DepositState.Requested) {
            request.state = DepositState.Settled;
            emit DepositSettled(depositId);
        }
        if (request.state == DepositState.Settled) {
            if (executedAssets == 0) revert AmountZero();
            request.executedAssets = executedAssets;
            request.state = DepositState.Executed;
            emit DepositExecuted(depositId, executedAssets);
        } else if (request.state == DepositState.Executed) {
            if (executedAssets == 0) {
                executedAssets = request.executedAssets;
            } else {
                request.executedAssets = executedAssets;
            }
        } else {
            revert DepositNotExecutable();
        }
        if (executedAssets == 0) revert AmountZero();

        uint256 supplyBefore = totalSupply;
        uint256 assetsBefore = totalManagedAssets;
        sharesMinted = convertToShares(executedAssets);
        if (sharesMinted == 0) revert SharesZero();

        request.executedAssets = executedAssets;
        request.sharesMinted = sharesMinted;
        request.state = DepositState.Finalized;

        totalManagedAssets = assetsBefore + executedAssets;
        _mint(request.user, sharesMinted);

        uint256 navBefore = supplyBefore == 0 ? 1_000_000 : (assetsBefore * 1_000_000) / supplyBefore;
        emit DepositFinalized(depositId, request.user, executedAssets, sharesMinted, navBefore);
    }

    /// @notice Updates NAV accounting for price movement in the Solana basket.
    function reportTotalManagedAssets(uint256 newTotalManagedAssets) external onlyReporter {
        uint256 oldTotalManagedAssets = totalManagedAssets;
        totalManagedAssets = newTotalManagedAssets;
        emit TotalManagedAssetsReported(oldTotalManagedAssets, newTotalManagedAssets);
    }

    /// @notice Burns shares and records an async redeem quote for later settlement.
    function requestRedeem(uint256 shares) external returns (bytes32 redeemId) {
        if (shares == 0) revert AmountZero();
        if (balanceOf[msg.sender] < shares) revert InsufficientBalance();

        uint256 assetsQuoted = convertToAssets(shares);
        redeemId = keccak256(
            abi.encodePacked(block.chainid, address(this), msg.sender, shares, nextRedeemNonce++)
        );

        redeems[redeemId] = RedeemRequest({
            user: msg.sender,
            sharesBurned: shares,
            assetsQuoted: assetsQuoted,
            state: RedeemState.Requested
        });

        _burn(msg.sender, shares);
        totalManagedAssets -= assetsQuoted;

        emit RedeemRequested(redeemId, msg.sender, shares, assetsQuoted);
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        if (totalSupply == 0 || totalManagedAssets == 0) return assets;
        return (assets * totalSupply) / totalManagedAssets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalSupply == 0) return shares;
        return (shares * totalManagedAssets) / totalSupply;
    }

    function nav() external view returns (uint256) {
        if (totalSupply == 0) return 1_000_000;
        return (totalManagedAssets * 1_000_000) / totalSupply;
    }

    function setReporter(address newReporter) external onlyReporter {
        if (newReporter == address(0)) revert ZeroAddress();
        emit ReporterUpdated(reporter, newReporter);
        reporter = newReporter;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _mint(address to, uint256 amount) private {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) private {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _knownDeposit(bytes32 depositId) private view returns (DepositRequest storage request) {
        request = deposits[depositId];
        if (request.user == address(0)) revert UnknownDeposit();
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
