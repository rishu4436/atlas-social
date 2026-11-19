// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAgentID} from "./interfaces/IAgentID.sol";
import {AgentIdGated} from "./AgentIdGated.sol";

/// @title AtlasPay
/// @notice Non-custodial Agent ID → Agent ID payments (BNB and one immutable BEP-20, USDT on BSC).
///         The recipient is resolved AT EXECUTION from the official Agent ID registry: `ownerOf(recipientTokenId)`,
///         where tokenId == uint256(keccak256(bytes(handle))) (verified live on BSC, see IAgentID). The sender
///         passes the address the ATLAS UI showed them (`expectedRecipient`); if the Agent ID's owner differs at
///         execution the payment reverts, so funds can only reach the address the sender approved.
/// @dev Funds are never held: BNB is forwarded in the same call; tokens move sender → recipient via
///      transferFrom (exact-amount approval to this contract). There is no owner, no admin, no upgrade path,
///      no withdraw, no receive()/fallback. The only state is the immutable configuration.
contract AtlasPay is AgentIdGated, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The only BEP-20 accepted (USDT 0x55d3…7955 on BSC; a mock on local/test chains).
    IERC20 public immutable stableToken;

    enum Kind {
        Direct, // Send to Agent ID (profile or DM)
        Tip, // voluntary tip on a post or thesis (never affects reputation)
        Request // settles an ATLAS payment request
    }

    /// @notice What the sender approved: the recipient Agent ID (tokenId), the owner address ATLAS showed
    ///         them, the payment kind and opaque references.
    struct Payment {
        uint256 recipientTokenId;
        address expectedRecipient;
        Kind kind;
        bytes32 contextRef;
        bytes32 memoHash;
    }

    /// @notice Payment receipt. `contextRef` is an opaque ATLAS reference (e.g. keccak of "post:<uuid>" or a
    ///         request id); `memoHash` is a hash of an optional note. Neither reveals message content.
    event PaymentSent(
        address indexed sender,
        address indexed recipient,
        bytes32 indexed contextRef,
        uint256 senderTokenId,
        uint256 recipientTokenId,
        address token, // address(0) for BNB
        uint256 amount,
        Kind kind,
        bytes32 memoHash
    );

    error ZeroAmount();
    error UnsupportedToken(address token);
    error RecipientNotFound(uint256 recipientTokenId);
    error RecipientChanged(address expected, address actual);
    error SelfPayment();
    error NativeTransferFailed();
    error TokenAmountMismatch(uint256 expected, uint256 received);

    constructor(IAgentID agentId_, IERC20 stableToken_) AgentIdGated(agentId_) {
        if (address(stableToken_) == address(0)) revert ZeroAddress();
        stableToken = stableToken_;
    }

    /// @notice Sends msg.value BNB to the current owner of `p.recipientTokenId`.
    function payNative(Payment calldata p) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        (uint256 senderTokenId, address recipient) = _parties(p.recipientTokenId, p.expectedRecipient);
        _emit(recipient, senderTokenId, p, address(0), msg.value);
        (bool ok,) = recipient.call{value: msg.value}("");
        if (!ok) revert NativeTransferFailed();
    }

    /// @notice Moves exactly `amount` of `token` from the sender to the current owner of `p.recipientTokenId`.
    ///         Requires the sender to have approved this contract for at least `amount` (ATLAS asks for exactly it).
    function payToken(IERC20 token, uint256 amount, Payment calldata p) external nonReentrant {
        if (token != stableToken) revert UnsupportedToken(address(token));
        if (amount == 0) revert ZeroAmount();
        (uint256 senderTokenId, address recipient) = _parties(p.recipientTokenId, p.expectedRecipient);
        uint256 before = token.balanceOf(recipient);
        token.safeTransferFrom(msg.sender, recipient, amount);
        uint256 received = token.balanceOf(recipient) - before;
        if (received != amount) revert TokenAmountMismatch(amount, received);
        _emit(recipient, senderTokenId, p, address(token), amount);
    }

    function _emit(address recipient, uint256 senderTokenId, Payment calldata p, address token, uint256 amount)
        internal
    {
        emit PaymentSent(
            msg.sender, recipient, p.contextRef, senderTokenId, p.recipientTokenId, token, amount, p.kind, p.memoHash
        );
    }

    /// @notice Read-only helper for UIs: the address a payment to `recipientTokenId` would reach right now.
    ///         Reverts if the Agent ID has no owner. (Resolution only — the API exposes it solely inside a send flow.)
    function recipientOf(uint256 recipientTokenId) external view returns (address) {
        return _owner(recipientTokenId);
    }

    function _parties(uint256 recipientTokenId, address expectedRecipient)
        internal
        view
        returns (uint256 senderTokenId, address recipient)
    {
        (senderTokenId,) = _verifiedAgentToken(msg.sender);
        recipient = _owner(recipientTokenId);
        if (recipient != expectedRecipient) revert RecipientChanged(expectedRecipient, recipient);
        if (recipient == msg.sender) revert SelfPayment();
    }

    function _owner(uint256 tokenId) internal view returns (address o) {
        try agentId.ownerOf(tokenId) returns (address x) {
            o = x;
        } catch {
            revert RecipientNotFound(tokenId);
        }
        if (o == address(0)) revert RecipientNotFound(tokenId);
    }
}
