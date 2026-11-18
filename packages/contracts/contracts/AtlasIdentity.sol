// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentIdGated} from "./AgentIdGated.sol";
import {IAgentID} from "./interfaces/IAgentID.sol";

/// @title AtlasIdentity
/// @notice On-chain proof of Agent ID ownership for ATLAS sign-in.
///         The ATLAS backend issues a short-lived random challenge; the holder submits it from their
///         own Agentic Wallet (e.g. `baw contract-call preview/execute`). The contract checks that the
///         caller holds an Agent ID and emits an event the backend verifies before binding the account.
///         No owner, no admin, no funds. Each challenge can be used exactly once.
contract AtlasIdentity is AgentIdGated {
    mapping(bytes32 => address) public challengeUsedBy;
    mapping(address => uint256) public proofCount;

    event IdentityProven(
        address indexed wallet,
        bytes32 indexed challenge,
        string handle,
        uint256 proofIndex,
        uint256 timestamp
    );

    error ChallengeAlreadyUsed(bytes32 challenge);
    error EmptyChallenge();

    constructor(IAgentID agentId_) AgentIdGated(agentId_) {}

    /// @param challenge keccak256 of the ATLAS login challenge (never a secret; it is single-use).
    function prove(bytes32 challenge) external onlyAgentId {
        if (challenge == bytes32(0)) revert EmptyChallenge();
        if (challengeUsedBy[challenge] != address(0)) revert ChallengeAlreadyUsed(challenge);
        challengeUsedBy[challenge] = msg.sender;
        uint256 idx = ++proofCount[msg.sender];
        emit IdentityProven(msg.sender, challenge, _handleOf(msg.sender), idx, block.timestamp);
    }
}
