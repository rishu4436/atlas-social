// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AgentIdGated} from "./AgentIdGated.sol";
import {IAgentID} from "./interfaces/IAgentID.sol";
import {AtlasThesisRegistry} from "./AtlasThesisRegistry.sol";

/// @title AtlasOutcomeRegistry
/// @notice Verifiable performance attestations with public dispute windows.
///   A disclosed evaluator set proposes outcomes with the hash of the complete market-data evidence file
///   (published off-chain so anyone can recompute it). Any Agent ID holder can challenge during the
///   dispute window; challenged outcomes must be re-proposed (max 3 rounds). Undisputed outcomes finalize
///   permissionlessly. If data is missing/stale or intraperiod sequencing is ambiguous the evaluator must
///   propose `Unresolved` rather than pick a side. Unrevealed theses past their reveal deadline, and
///   cancellations before reveal, are forfeited permissionlessly.
///
/// OWNER POWERS (disclosed): add/remove evaluator addresses; two-step ownership transfer. The owner cannot
/// change theses or outcomes, cannot pause, cannot upgrade, and the contract never holds assets.
contract AtlasOutcomeRegistry is AgentIdGated, Ownable2Step {
    enum Outcome {
        None,
        TargetHit,
        InvalidationHit,
        Expired,
        Unresolved,
        Void,
        Forfeited
    }

    enum State {
        None,
        Proposed,
        Challenged,
        Final
    }

    struct Attestation {
        Outcome outcome;
        State state;
        uint8 round;
        address evaluator;
        uint64 proposedAt;
        uint64 observedAt;
        uint128 observedPrice;
        bytes32 evidenceHash;
    }

    uint8 public constant MAX_ROUNDS = 3;

    AtlasThesisRegistry public immutable theses;
    uint64 public immutable disputeWindow;

    mapping(address => bool) public isEvaluator;
    uint256 public evaluatorCount;
    mapping(uint256 => Attestation) private _attestations;
    uint256 public finalizedCount;

    event EvaluatorSet(address indexed evaluator, bool enabled);
    event OutcomeProposed(
        uint256 indexed thesisId,
        address indexed evaluator,
        Outcome outcome,
        uint64 observedAt,
        uint128 observedPrice,
        bytes32 evidenceHash,
        uint8 round
    );
    event OutcomeChallenged(uint256 indexed thesisId, address indexed challenger, bytes32 reasonHash, string handle);
    event OutcomeFinalized(uint256 indexed thesisId, Outcome outcome);

    error NotEvaluator();
    error NotPublished();
    error BadState(State state);
    error BadOutcome();
    error TooEarly();
    error WindowClosed();
    error ObservationOutOfWindow();
    error MaxRounds();
    error NotForfeitable();
    error EvaluatorCannotChallenge();

    constructor(IAgentID agentId_, AtlasThesisRegistry theses_, uint64 disputeWindow_, address owner_)
        AgentIdGated(agentId_)
        Ownable(owner_)
    {
        if (address(theses_) == address(0)) revert ZeroAddress();
        theses = theses_;
        disputeWindow = disputeWindow_;
    }

    modifier onlyEvaluator() {
        if (!isEvaluator[msg.sender]) revert NotEvaluator();
        _;
    }

    function setEvaluator(address evaluator, bool enabled) external onlyOwner {
        if (evaluator == address(0)) revert ZeroAddress();
        if (isEvaluator[evaluator] == enabled) return;
        isEvaluator[evaluator] = enabled;
        if (enabled) evaluatorCount++;
        else evaluatorCount--;
        emit EvaluatorSet(evaluator, enabled);
    }

    function proposeOutcome(
        uint256 thesisId,
        Outcome outcome,
        uint64 observedAt,
        uint128 observedPrice,
        bytes32 evidenceHash
    ) external onlyEvaluator {
        if (outcome == Outcome.None || outcome == Outcome.Forfeited) revert BadOutcome();
        if (evidenceHash == bytes32(0)) revert BadOutcome();
        if (!theses.isPublished(thesisId)) revert NotPublished();
        (uint64 start, uint64 end) = theses.observationWindow(thesisId);

        Attestation storage a = _attestations[thesisId];
        if (a.state != State.None && a.state != State.Challenged) revert BadState(a.state);
        if (a.round >= MAX_ROUNDS) revert MaxRounds();

        if (outcome == Outcome.TargetHit || outcome == Outcome.InvalidationHit) {
            if (observedAt < start || observedAt > end) revert ObservationOutOfWindow();
            if (observedAt > block.timestamp) revert TooEarly();
            if (observedPrice == 0) revert BadOutcome();
        } else if (outcome == Outcome.Expired || outcome == Outcome.Unresolved) {
            if (block.timestamp <= end) revert TooEarly();
        }

        a.outcome = outcome;
        a.state = State.Proposed;
        a.round += 1;
        a.evaluator = msg.sender;
        a.proposedAt = uint64(block.timestamp);
        a.observedAt = observedAt;
        a.observedPrice = observedPrice;
        a.evidenceHash = evidenceHash;
        emit OutcomeProposed(thesisId, msg.sender, outcome, observedAt, observedPrice, evidenceHash, a.round);
    }

    function challengeOutcome(uint256 thesisId, bytes32 reasonHash) external onlyAgentId {
        Attestation storage a = _attestations[thesisId];
        if (a.state != State.Proposed) revert BadState(a.state);
        if (block.timestamp > a.proposedAt + disputeWindow) revert WindowClosed();
        if (isEvaluator[msg.sender]) revert EvaluatorCannotChallenge();
        (, string memory handle) = _verifiedAgentToken(msg.sender);
        a.state = State.Challenged;
        emit OutcomeChallenged(thesisId, msg.sender, reasonHash, handle);
    }

    function finalizeOutcome(uint256 thesisId) external {
        Attestation storage a = _attestations[thesisId];
        if (a.state != State.Proposed) revert BadState(a.state);
        if (block.timestamp <= a.proposedAt + disputeWindow) revert TooEarly();
        a.state = State.Final;
        finalizedCount++;
        emit OutcomeFinalized(thesisId, a.outcome);
    }

    function forfeit(uint256 thesisId) external {
        AtlasThesisRegistry.ThesisRecord memory r = theses.getThesis(thesisId);
        bool expiredHidden = r.status == AtlasThesisRegistry.Status.Committed && block.timestamp > r.revealDeadline;
        bool cancelledHidden = r.status == AtlasThesisRegistry.Status.Cancelled && r.cancelledBeforeReveal;
        if (!expiredHidden && !cancelledHidden) revert NotForfeitable();
        Attestation storage a = _attestations[thesisId];
        if (a.state == State.Final) revert BadState(a.state);
        a.outcome = Outcome.Forfeited;
        a.state = State.Final;
        a.proposedAt = uint64(block.timestamp);
        finalizedCount++;
        emit OutcomeFinalized(thesisId, Outcome.Forfeited);
    }

    function getAttestation(uint256 thesisId) external view returns (Attestation memory) {
        return _attestations[thesisId];
    }
}
