// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentIdGated} from "./AgentIdGated.sol";
import {IAgentID} from "./interfaces/IAgentID.sol";

/// @title ThesisRegistry
/// @notice Immutable trade theses for ATLAS Social.
///   * An Agent ID holder commits a hash of the thesis terms BEFORE the observation window starts.
///   * Terms can be revealed immediately (public thesis) or later (commit-reveal, private until reveal).
///   * Reveal must match the commitment exactly and must happen before the author's declared `revealBy`.
///     Unrevealed commitments past `revealBy` are treated as forfeited by the performance engine, so
///     authors cannot commit many ideas and reveal only the winners.
///   * Terms can never be edited. Corrections are append-only notes. Cancellation is recorded, not erased.
///   * Other Agent ID holders can endorse or challenge a thesis on-chain (one review per holder).
///   No owner, no admin, no upgradeability, no token custody.
contract ThesisRegistry is AgentIdGated {
    /// @dev Terms are hashed with abi.encode; prices use 8 decimals (1e8 = 1.0 quote unit).
    struct Terms {
        bytes32 market; // e.g. "BINANCE:BNBUSDT"
        bytes32 priceSource; // e.g. "BINANCE_SPOT_KLINE_1H"
        uint8 direction; // 1 = LONG (expects up), 2 = SHORT (expects down)
        uint128 entryPrice; // 0 = first observation at startTime
        uint128 targetPrice;
        uint128 invalidationPrice;
        uint64 startTime;
        uint64 endTime;
        uint16 confidenceBps; // 0..10000
        uint16 methodology; // evaluation methodology version
        bytes32 contentHash; // keccak256 of the canonical off-chain research document
    }

    enum Status {
        None,
        Committed,
        Revealed,
        Cancelled
    }

    struct Thesis {
        address author;
        uint64 committedAt;
        uint64 revealBy;
        uint64 revealedAt;
        uint64 cancelledAt;
        Status status;
        bool cancelledBeforeReveal;
        uint32 corrections;
        uint32 endorsements;
        uint32 challenges;
        bytes32 commitment;
    }

    bytes32 public constant COMMIT_TYPEHASH = keccak256("ATLAS_THESIS_COMMITMENT_V1");
    uint64 public constant MAX_REVEAL_WINDOW = 400 days;
    uint8 public constant LONG = 1;
    uint8 public constant SHORT = 2;
    uint8 public constant STANCE_ENDORSE = 1;
    uint8 public constant STANCE_CHALLENGE = 2;

    uint256 public thesisCount;
    mapping(uint256 => Thesis) private _theses;
    mapping(uint256 => Terms) private _terms;
    mapping(bytes32 => uint256) public thesisIdByCommitment;
    mapping(uint256 => mapping(address => uint8)) public reviewOf;
    mapping(address => uint256) public authoredCount;

    event ThesisCommitted(
        uint256 indexed thesisId, address indexed author, bytes32 indexed commitment, uint64 revealBy, string handle
    );
    event ThesisRevealed(uint256 indexed thesisId, address indexed author, bytes32 indexed market, Terms terms);
    event ThesisCorrected(uint256 indexed thesisId, uint32 indexed index, bytes32 noteHash);
    event ThesisCancelled(uint256 indexed thesisId, bool beforeReveal);
    event ThesisReviewed(uint256 indexed thesisId, address indexed reviewer, uint8 stance, bytes32 noteHash, string handle);

    error InvalidCommitment();
    error CommitmentExists(uint256 thesisId);
    error InvalidRevealBy();
    error UnknownThesis(uint256 thesisId);
    error NotAuthor();
    error BadStatus(Status status);
    error CommitmentMismatch();
    error RevealWindowClosed();
    error InvalidTerms(string reason);
    error SelfReview();
    error AlreadyReviewed();
    error InvalidStance();

    constructor(IAgentID agentId_) AgentIdGated(agentId_) {}

    // ------------------------------------------------------------------ hashing

    function computeCommitment(address author, Terms calldata terms, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(COMMIT_TYPEHASH, block.chainid, address(this), author, terms, salt));
    }

    // ------------------------------------------------------------------ writes

    /// @notice Commit a hidden thesis. Terms stay private until `reveal`.
    function commit(bytes32 commitment, uint64 revealBy) external onlyAgentId returns (uint256 thesisId) {
        thesisId = _commit(msg.sender, commitment, revealBy);
    }

    /// @notice Commit and reveal in one transaction (public thesis).
    function publish(Terms calldata terms, bytes32 salt, uint64 revealBy) external onlyAgentId returns (uint256 thesisId) {
        bytes32 c = computeCommitment(msg.sender, terms, salt);
        thesisId = _commit(msg.sender, c, revealBy);
        _reveal(thesisId, terms);
    }

    function reveal(uint256 thesisId, Terms calldata terms, bytes32 salt) external {
        Thesis storage t = _get(thesisId);
        if (t.status != Status.Committed) revert BadStatus(t.status);
        if (block.timestamp > t.revealBy) revert RevealWindowClosed();
        if (computeCommitment(t.author, terms, salt) != t.commitment) revert CommitmentMismatch();
        _reveal(thesisId, terms);
    }

    function correct(uint256 thesisId, bytes32 noteHash) external {
        Thesis storage t = _get(thesisId);
        if (t.author != msg.sender) revert NotAuthor();
        if (t.status == Status.Cancelled) revert BadStatus(t.status);
        uint32 idx = ++t.corrections;
        emit ThesisCorrected(thesisId, idx, noteHash);
    }

    /// @notice Cancellation is permanent and public. The engine scores cancellations made after the
    ///         observation window started (or before reveal) as losses/forfeits.
    function cancel(uint256 thesisId) external {
        Thesis storage t = _get(thesisId);
        if (t.author != msg.sender) revert NotAuthor();
        if (t.status != Status.Committed && t.status != Status.Revealed) revert BadStatus(t.status);
        t.cancelledBeforeReveal = t.status == Status.Committed;
        t.status = Status.Cancelled;
        t.cancelledAt = uint64(block.timestamp);
        emit ThesisCancelled(thesisId, t.cancelledBeforeReveal);
    }

    function review(uint256 thesisId, uint8 stance, bytes32 noteHash) external onlyAgentId {
        Thesis storage t = _get(thesisId);
        if (t.author == msg.sender) revert SelfReview();
        if (stance != STANCE_ENDORSE && stance != STANCE_CHALLENGE) revert InvalidStance();
        if (reviewOf[thesisId][msg.sender] != 0) revert AlreadyReviewed();
        reviewOf[thesisId][msg.sender] = stance;
        if (stance == STANCE_ENDORSE) t.endorsements++;
        else t.challenges++;
        emit ThesisReviewed(thesisId, msg.sender, stance, noteHash, _handleOf(msg.sender));
    }

    // ------------------------------------------------------------------ reads

    function getThesis(uint256 thesisId) external view returns (Thesis memory) {
        return _get(thesisId);
    }

    function getTerms(uint256 thesisId) external view returns (Terms memory) {
        Thesis storage t = _get(thesisId);
        if (t.revealedAt == 0) revert BadStatus(t.status);
        return _terms[thesisId];
    }

    function isRevealed(uint256 thesisId) external view returns (bool) {
        return _theses[thesisId].revealedAt != 0;
    }

    // ------------------------------------------------------------------ internals

    function _get(uint256 thesisId) internal view returns (Thesis storage t) {
        t = _theses[thesisId];
        if (t.status == Status.None) revert UnknownThesis(thesisId);
    }

    function _commit(address author, bytes32 commitment, uint64 revealBy) internal returns (uint256 thesisId) {
        if (commitment == bytes32(0)) revert InvalidCommitment();
        uint256 existing = thesisIdByCommitment[commitment];
        if (existing != 0) revert CommitmentExists(existing);
        if (revealBy <= block.timestamp || revealBy > block.timestamp + MAX_REVEAL_WINDOW) revert InvalidRevealBy();
        thesisId = ++thesisCount;
        Thesis storage t = _theses[thesisId];
        t.author = author;
        t.committedAt = uint64(block.timestamp);
        t.revealBy = revealBy;
        t.status = Status.Committed;
        t.commitment = commitment;
        thesisIdByCommitment[commitment] = thesisId;
        authoredCount[author]++;
        emit ThesisCommitted(thesisId, author, commitment, revealBy, _handleOf(author));
    }

    function _reveal(uint256 thesisId, Terms calldata terms) internal {
        Thesis storage t = _theses[thesisId];
        _validate(t, terms);
        t.status = Status.Revealed;
        t.revealedAt = uint64(block.timestamp);
        _terms[thesisId] = terms;
        emit ThesisRevealed(thesisId, t.author, terms.market, terms);
    }

    function _validate(Thesis storage t, Terms calldata x) internal view {
        if (x.market == bytes32(0)) revert InvalidTerms("market");
        if (x.priceSource == bytes32(0)) revert InvalidTerms("priceSource");
        if (x.startTime < t.committedAt) revert InvalidTerms("start before commit");
        if (x.endTime <= x.startTime) revert InvalidTerms("window");
        if (x.endTime > t.revealBy) revert InvalidTerms("end after revealBy");
        if (x.confidenceBps > 10_000) revert InvalidTerms("confidence");
        if (x.targetPrice == 0 || x.invalidationPrice == 0) revert InvalidTerms("levels");
        if (x.direction == LONG) {
            if (x.targetPrice <= x.invalidationPrice) revert InvalidTerms("long levels");
            if (x.entryPrice != 0 && (x.entryPrice >= x.targetPrice || x.entryPrice <= x.invalidationPrice)) {
                revert InvalidTerms("long entry");
            }
        } else if (x.direction == SHORT) {
            if (x.targetPrice >= x.invalidationPrice) revert InvalidTerms("short levels");
            if (x.entryPrice != 0 && (x.entryPrice <= x.targetPrice || x.entryPrice >= x.invalidationPrice)) {
                revert InvalidTerms("short entry");
            }
        } else {
            revert InvalidTerms("direction");
        }
    }
}
