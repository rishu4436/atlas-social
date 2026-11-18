// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentIdGated} from "./AgentIdGated.sol";
import {IAgentID} from "./interfaces/IAgentID.sol";

/// @title AtlasThesisRegistry
/// @notice Immutable financial prediction commitments ("verified theses") by Agent ID holders.
///   * `publishThesis` anchors the full structured terms publicly; the observation window starts at the
///     block timestamp, so a thesis can never claim a start before it existed on-chain.
///   * Opt-in privacy: `commitThesis` anchors only a hash, `revealThesis` discloses matching terms before the
///     author-declared reveal deadline. The observation window still starts at the commit time. Unrevealed
///     commitments past the deadline (and cancellations before reveal) are forfeited in AtlasOutcomeRegistry,
///     so authors cannot commit many ideas and reveal only winners.
///   * Terms are never editable. `appendCorrection` adds notes; `cancelThesis` is permanent and public.
///   Prices use 8 decimals and are quoted as quoteAsset per 1 baseAsset.
///   No owner, no admin, no upgradeability, no token custody.
contract AtlasThesisRegistry is AgentIdGated {
    enum Direction {
        None,
        Long,
        Short
    }

    enum EntryKind {
        Market, // first observation at window start
        AtOrBelow, // entry triggers when price <= price
        AtOrAbove // entry triggers when price >= price
    }

    enum Comparator {
        None,
        GTE, // condition met when observed price >= price
        LTE // condition met when observed price <= price
    }

    enum Status {
        None,
        Committed,
        Published,
        Cancelled
    }

    struct EntryCondition {
        EntryKind kind;
        uint128 price;
    }

    struct PriceCondition {
        Comparator comparator;
        uint128 price;
    }

    struct ThesisTerms {
        address baseAsset;
        address quoteAsset;
        Direction direction;
        EntryCondition entry;
        PriceCondition target;
        PriceCondition invalidation;
        uint64 evaluationDeadline;
        bytes32 methodologyHash;
        bytes32 contentHash;
    }

    struct ThesisRecord {
        address author;
        uint256 agentTokenId;
        uint64 startTime;
        uint64 revealDeadline;
        uint64 publishedAt;
        uint64 cancelledAt;
        Status status;
        bool cancelledBeforeReveal;
        uint32 corrections;
        bytes32 commitment;
    }

    bytes32 public constant COMMITMENT_TYPEHASH = keccak256("ATLAS_THESIS_V1");
    uint64 public constant MAX_HORIZON = 400 days;

    uint256 public thesisCount;
    mapping(uint256 => ThesisRecord) private _records;
    mapping(uint256 => ThesisTerms) private _terms;
    mapping(bytes32 => uint256) public thesisIdByCommitment;
    mapping(address => uint256) public authoredCount;

    event ThesisCommitted(
        uint256 indexed thesisId,
        address indexed author,
        bytes32 indexed commitment,
        uint256 agentTokenId,
        uint64 startTime,
        uint64 revealDeadline,
        string handle
    );
    event ThesisPublished(uint256 indexed thesisId, address indexed author, bytes32 indexed commitment, ThesisTerms terms);
    event CorrectionAppended(uint256 indexed thesisId, uint32 indexed index, bytes32 noteHash);
    event ThesisCancelled(uint256 indexed thesisId, bool beforeReveal);

    error EmptyCommitment();
    error CommitmentExists(uint256 thesisId);
    error InvalidRevealDeadline();
    error UnknownThesis(uint256 thesisId);
    error NotAuthor();
    error BadStatus(Status status);
    error CommitmentMismatch();
    error RevealWindowClosed();
    error InvalidTerms(string reason);

    constructor(IAgentID agentId_) AgentIdGated(agentId_) {}

    // ------------------------------------------------------------------ hashing

    function computeCommitment(address author, ThesisTerms calldata terms, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(COMMITMENT_TYPEHASH, block.chainid, address(this), author, terms, salt));
    }

    // ------------------------------------------------------------------ writes

    function publishThesis(ThesisTerms calldata terms, bytes32 salt) external onlyAgentId returns (uint256 thesisId) {
        bytes32 c = computeCommitment(msg.sender, terms, salt);
        thesisId = _commit(c, terms.evaluationDeadline);
        _publish(thesisId, c, terms);
    }

    function commitThesis(bytes32 commitment, uint64 revealDeadline) external onlyAgentId returns (uint256 thesisId) {
        thesisId = _commit(commitment, revealDeadline);
    }

    function revealThesis(uint256 thesisId, ThesisTerms calldata terms, bytes32 salt) external {
        ThesisRecord storage r = _get(thesisId);
        if (r.status != Status.Committed) revert BadStatus(r.status);
        if (block.timestamp > r.revealDeadline) revert RevealWindowClosed();
        if (computeCommitment(r.author, terms, salt) != r.commitment) revert CommitmentMismatch();
        _publish(thesisId, r.commitment, terms);
    }

    function appendCorrection(uint256 thesisId, bytes32 noteHash) external {
        ThesisRecord storage r = _get(thesisId);
        if (r.author != msg.sender) revert NotAuthor();
        if (r.status == Status.Cancelled) revert BadStatus(r.status);
        uint32 idx = ++r.corrections;
        emit CorrectionAppended(thesisId, idx, noteHash);
    }

    function cancelThesis(uint256 thesisId) external {
        ThesisRecord storage r = _get(thesisId);
        if (r.author != msg.sender) revert NotAuthor();
        if (r.status == Status.Cancelled) revert BadStatus(r.status);
        r.cancelledBeforeReveal = r.status == Status.Committed;
        r.status = Status.Cancelled;
        r.cancelledAt = uint64(block.timestamp);
        emit ThesisCancelled(thesisId, r.cancelledBeforeReveal);
    }

    // ------------------------------------------------------------------ reads

    function getThesis(uint256 thesisId) external view returns (ThesisRecord memory) {
        return _get(thesisId);
    }

    function getTerms(uint256 thesisId) external view returns (ThesisTerms memory) {
        ThesisRecord storage r = _get(thesisId);
        if (r.publishedAt == 0) revert BadStatus(r.status);
        return _terms[thesisId];
    }

    function authorOf(uint256 thesisId) external view returns (address) {
        return _get(thesisId).author;
    }

    function isPublished(uint256 thesisId) external view returns (bool) {
        return _records[thesisId].publishedAt != 0;
    }

    /// @return start observation window start, end evaluation deadline (0 if unpublished)
    function observationWindow(uint256 thesisId) external view returns (uint64 start, uint64 end) {
        ThesisRecord storage r = _get(thesisId);
        start = r.startTime;
        end = r.publishedAt == 0 ? 0 : _terms[thesisId].evaluationDeadline;
    }

    // ------------------------------------------------------------------ internals

    function _get(uint256 thesisId) internal view returns (ThesisRecord storage r) {
        r = _records[thesisId];
        if (r.status == Status.None) revert UnknownThesis(thesisId);
    }

    function _commit(bytes32 commitment, uint64 revealDeadline) internal returns (uint256 thesisId) {
        if (commitment == bytes32(0)) revert EmptyCommitment();
        uint256 existing = thesisIdByCommitment[commitment];
        if (existing != 0) revert CommitmentExists(existing);
        if (revealDeadline <= block.timestamp || revealDeadline > block.timestamp + MAX_HORIZON) {
            revert InvalidRevealDeadline();
        }
        (uint256 tokenId, string memory handle) = _verifiedAgentToken(msg.sender);
        thesisId = ++thesisCount;
        ThesisRecord storage r = _records[thesisId];
        r.author = msg.sender;
        r.agentTokenId = tokenId;
        r.startTime = uint64(block.timestamp);
        r.revealDeadline = revealDeadline;
        r.status = Status.Committed;
        r.commitment = commitment;
        thesisIdByCommitment[commitment] = thesisId;
        authoredCount[msg.sender]++;
        emit ThesisCommitted(thesisId, msg.sender, commitment, tokenId, r.startTime, revealDeadline, handle);
    }

    function _publish(uint256 thesisId, bytes32 commitment, ThesisTerms calldata terms) internal {
        ThesisRecord storage r = _records[thesisId];
        _validate(r, terms);
        r.status = Status.Published;
        r.publishedAt = uint64(block.timestamp);
        _terms[thesisId] = terms;
        emit ThesisPublished(thesisId, r.author, commitment, terms);
    }

    function _validate(ThesisRecord storage r, ThesisTerms calldata x) internal view {
        if (x.baseAsset == address(0) || x.quoteAsset == address(0) || x.baseAsset == x.quoteAsset) {
            revert InvalidTerms("assets");
        }
        if (x.methodologyHash == bytes32(0)) revert InvalidTerms("methodology");
        if (x.contentHash == bytes32(0)) revert InvalidTerms("content");
        if (x.evaluationDeadline <= r.startTime) revert InvalidTerms("deadline");
        if (x.evaluationDeadline > r.revealDeadline) revert InvalidTerms("deadline after reveal");
        if (x.target.price == 0 || x.invalidation.price == 0) revert InvalidTerms("levels");
        if (x.direction == Direction.Long) {
            if (x.target.comparator != Comparator.GTE || x.invalidation.comparator != Comparator.LTE) {
                revert InvalidTerms("long comparators");
            }
            if (x.target.price <= x.invalidation.price) revert InvalidTerms("long levels");
        } else if (x.direction == Direction.Short) {
            if (x.target.comparator != Comparator.LTE || x.invalidation.comparator != Comparator.GTE) {
                revert InvalidTerms("short comparators");
            }
            if (x.target.price >= x.invalidation.price) revert InvalidTerms("short levels");
        } else {
            revert InvalidTerms("direction");
        }
        if (x.entry.kind == EntryKind.Market) {
            if (x.entry.price != 0) revert InvalidTerms("entry");
        } else {
            (uint128 lo, uint128 hi) = x.direction == Direction.Long
                ? (x.invalidation.price, x.target.price)
                : (x.target.price, x.invalidation.price);
            if (x.entry.price <= lo || x.entry.price >= hi) revert InvalidTerms("entry");
        }
    }
}
