// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentIdGated} from "./AgentIdGated.sol";
import {IAgentID} from "./interfaces/IAgentID.sol";

/// @title AtlasIdentityRegistry
/// @notice Agent ID eligibility and account commitments for ATLAS Social.
///   Login fallback (and a genuine on-chain Agent ID interaction): the ATLAS backend issues a short-lived
///   random challenge and the user submits `registerIdentity(commitment)` from their own Agentic Wallet
///   (`baw contract-call preview` -> `execute`). The contract checks that the caller holds the Agent ID
///   token it claims, consumes the commitment (single use) and emits an event the backend verifies after
///   confirmation before binding the identity to an account.
///   commitment = keccak256(abi.encode("ATLAS_LOGIN_V1", chainId, registry, wallet, loginId, nonce))
///   No owner, no admin, no upgradeability, no funds.
contract AtlasIdentityRegistry is AgentIdGated {
    struct Identity {
        uint256 agentTokenId;
        uint64 registeredAt;
        uint64 lastProofAt;
        uint32 proofCount;
    }

    mapping(address => Identity) private _identities;
    mapping(bytes32 => address) public commitmentUsedBy;
    uint256 public registeredCount;

    event IdentityRegistered(
        address indexed wallet,
        uint256 indexed agentTokenId,
        bytes32 indexed commitment,
        string handle,
        uint32 proofCount,
        bool firstRegistration
    );

    error EmptyCommitment();
    error CommitmentAlreadyUsed(bytes32 commitment);

    constructor(IAgentID agentId_) AgentIdGated(agentId_) {}

    function registerIdentity(bytes32 commitment) external onlyAgentId {
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (commitmentUsedBy[commitment] != address(0)) revert CommitmentAlreadyUsed(commitment);
        (uint256 tokenId, string memory handle) = _verifiedAgentToken(msg.sender);
        commitmentUsedBy[commitment] = msg.sender;

        Identity storage id = _identities[msg.sender];
        bool first = id.registeredAt == 0;
        if (first) {
            id.registeredAt = uint64(block.timestamp);
            registeredCount++;
        }
        id.agentTokenId = tokenId;
        id.lastProofAt = uint64(block.timestamp);
        id.proofCount += 1;
        emit IdentityRegistered(msg.sender, tokenId, commitment, handle, id.proofCount, first);
    }

    /// @notice Live verification: does `wallet` hold the Agent ID token for its handle, and has it registered?
    function verifyIdentity(address wallet)
        external
        view
        returns (bool eligible, bool registered, uint256 agentTokenId, string memory handle)
    {
        (eligible, agentTokenId, handle) = _isEligible(wallet);
        Identity storage id = _identities[wallet];
        registered = id.registeredAt != 0 && eligible && id.agentTokenId == agentTokenId;
    }

    function identityOf(address wallet) external view returns (Identity memory) {
        return _identities[wallet];
    }
}
