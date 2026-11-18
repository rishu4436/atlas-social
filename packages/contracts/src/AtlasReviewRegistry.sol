// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentIdGated} from "./AgentIdGated.sol";
import {IAgentID} from "./interfaces/IAgentID.sol";
import {AtlasThesisRegistry} from "./AtlasThesisRegistry.sol";

/// @title AtlasReviewRegistry
/// @notice Attributable peer reviews and evidence challenges by Agent ID holders.
///   Each holder can publish one review per thesis and challenge each specific piece of evidence once.
///   Review text and challenge reasoning live off-chain; only content hashes are anchored here.
///   No owner, no admin, no upgradeability, no funds.
contract AtlasReviewRegistry is AgentIdGated {
    enum Stance {
        None,
        Endorse,
        Dispute,
        Neutral
    }

    enum EvidenceKind {
        None,
        ThesisContent,
        TradeProof,
        OutcomeEvidence,
        MarketData
    }

    struct Review {
        uint256 thesisId;
        address reviewer;
        Stance stance;
        uint64 createdAt;
        bytes32 contentHash;
    }

    struct Challenge {
        uint256 thesisId;
        address challenger;
        EvidenceKind kind;
        uint64 createdAt;
        bytes32 evidenceHash;
        bytes32 reasonHash;
    }

    AtlasThesisRegistry public immutable theses;

    uint256 public reviewCount;
    uint256 public challengeCount;
    mapping(uint256 => Review) private _reviews;
    mapping(uint256 => Challenge) private _challenges;
    mapping(uint256 => mapping(address => uint256)) public reviewIdOf;
    mapping(bytes32 => uint256) public challengeIdOfKey;
    mapping(uint256 => uint256[3]) private _stanceCounts; // endorse, dispute, neutral
    mapping(uint256 => uint256) public challengesOnThesis;

    event ReviewPublished(
        uint256 indexed reviewId, uint256 indexed thesisId, address indexed reviewer, Stance stance, bytes32 contentHash, string handle
    );
    event EvidenceChallenged(
        uint256 indexed challengeId,
        uint256 indexed thesisId,
        address indexed challenger,
        EvidenceKind kind,
        bytes32 evidenceHash,
        bytes32 reasonHash,
        string handle
    );

    error SelfReview();
    error AlreadyReviewed(uint256 reviewId);
    error InvalidStance();
    error InvalidEvidence();
    error AlreadyChallenged(uint256 challengeId);

    constructor(IAgentID agentId_, AtlasThesisRegistry theses_) AgentIdGated(agentId_) {
        if (address(theses_) == address(0)) revert ZeroAddress();
        theses = theses_;
    }

    function publishReview(uint256 thesisId, Stance stance, bytes32 contentHash)
        external
        onlyAgentId
        returns (uint256 reviewId)
    {
        if (stance == Stance.None) revert InvalidStance();
        if (theses.authorOf(thesisId) == msg.sender) revert SelfReview(); // reverts on unknown thesis
        uint256 existing = reviewIdOf[thesisId][msg.sender];
        if (existing != 0) revert AlreadyReviewed(existing);
        (, string memory handle) = _verifiedAgentToken(msg.sender);
        reviewId = ++reviewCount;
        _reviews[reviewId] = Review(thesisId, msg.sender, stance, uint64(block.timestamp), contentHash);
        reviewIdOf[thesisId][msg.sender] = reviewId;
        _stanceCounts[thesisId][uint8(stance) - 1]++;
        emit ReviewPublished(reviewId, thesisId, msg.sender, stance, contentHash, handle);
    }

    function challengeEvidence(uint256 thesisId, EvidenceKind kind, bytes32 evidenceHash, bytes32 reasonHash)
        external
        onlyAgentId
        returns (uint256 challengeId)
    {
        if (kind == EvidenceKind.None || evidenceHash == bytes32(0)) revert InvalidEvidence();
        if (theses.authorOf(thesisId) == msg.sender) revert SelfReview();
        bytes32 key = keccak256(abi.encode(thesisId, msg.sender, kind, evidenceHash));
        uint256 existing = challengeIdOfKey[key];
        if (existing != 0) revert AlreadyChallenged(existing);
        (, string memory handle) = _verifiedAgentToken(msg.sender);
        challengeId = ++challengeCount;
        _challenges[challengeId] =
            Challenge(thesisId, msg.sender, kind, uint64(block.timestamp), evidenceHash, reasonHash);
        challengeIdOfKey[key] = challengeId;
        challengesOnThesis[thesisId]++;
        emit EvidenceChallenged(challengeId, thesisId, msg.sender, kind, evidenceHash, reasonHash, handle);
    }

    function getReview(uint256 reviewId) external view returns (Review memory) {
        return _reviews[reviewId];
    }

    function getChallenge(uint256 challengeId) external view returns (Challenge memory) {
        return _challenges[challengeId];
    }

    function stanceCounts(uint256 thesisId) external view returns (uint256 endorse, uint256 dispute, uint256 neutral) {
        uint256[3] storage c = _stanceCounts[thesisId];
        return (c[0], c[1], c[2]);
    }
}
