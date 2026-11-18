// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentID} from "./interfaces/IAgentID.sol";

/// @title AgentIdGated
/// @notice The *caller itself* must hold a Binance Agent ID. Checked live on every protected call, so a
///         revoked Agent ID loses access immediately. Token ownership is verified via handle -> tokenId.
abstract contract AgentIdGated {
    IAgentID public immutable agentId;

    error ZeroAddress();
    error NotAgentIdHolder(address caller);
    error AgentTokenMismatch(address caller);

    constructor(IAgentID agentId_) {
        if (address(agentId_) == address(0)) revert ZeroAddress();
        agentId = agentId_;
    }

    modifier onlyAgentId() {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder(msg.sender);
        _;
    }

    /// @return tokenId the caller's Agent ID token, after verifying ownerOf(tokenId) == account.
    function _verifiedAgentToken(address account) internal view returns (uint256 tokenId, string memory handle) {
        handle = agentId.handleOf(account);
        if (bytes(handle).length == 0) revert NotAgentIdHolder(account);
        tokenId = uint256(keccak256(bytes(handle)));
        address owner;
        try agentId.ownerOf(tokenId) returns (address o) {
            owner = o;
        } catch {
            revert AgentTokenMismatch(account);
        }
        if (owner != account) revert AgentTokenMismatch(account);
    }

    function _isEligible(address account) internal view returns (bool ok, uint256 tokenId, string memory handle) {
        if (agentId.balanceOf(account) == 0) return (false, 0, "");
        handle = agentId.handleOf(account);
        if (bytes(handle).length == 0) return (false, 0, "");
        tokenId = uint256(keccak256(bytes(handle)));
        try agentId.ownerOf(tokenId) returns (address o) {
            ok = o == account;
        } catch {
            ok = false;
        }
        if (!ok) return (false, 0, "");
    }
}
