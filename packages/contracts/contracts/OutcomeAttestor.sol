// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AgentIdGated} from "./AgentIdGated.sol";
import {IAgentID} from "./interfaces/IAgentID.sol";
import {ThesisRegistry} from "./ThesisRegistry.sol";

/// @title OutcomeAttestor
/// @notice Publicly auditable outcome attestations for revealed theses.
///   A disclosed evaluator set proposes an outcome plus the hash of the full market-data evidence
///   (the evidence file is published off-chain so anyone can recompute it). Any Agent ID holder can
///   dispute during the dispute window; disputed outcomes must be re-attested. Undisputed outcomes
///   finalize permissionlessly. Unrevealed theses past their reveal deadline can be marked Forfeited
///   by anyone, with no evaluator involved.
///
/// OWNER POWERS (disclosed): the owner can only add or remove evaluator addresses and transfer
/// ownership (two-step). The owner cannot edit theses, outcomes, or move any funds. The contract
/// holds no assets, cannot be paused and is not upgradeable.
contract OutcomeAttestor is AgentIdGated, Ownable2Step {
    enum Outcome {
        None,
        TargetHit,
        InvalidationHit,
        Expired,
        Ambiguous,
        Void,
        Forfeited
    }

    enum State {
        None,
        Proposed,
        Disputed,
        Final
    }

    struct Attestation {
        Outcome outcome;
        State state;
        uint8 round;
        address evaluator;
        uint64 proposedAt;
        uint64 observedAt;
        int32 returnBps;
        bytes32 evidenceHash;
    }

    uint8 public constant MAX_ROUNDS = 3;

    ThesisRegistry public immutable registry;
    uint64 public immutable disputeWindow;

    mapping(address => bool) public isEvaluator;
    uint256 public evaluatorCount;
    mapping(uint256 => Attestation) private _attestations;

    event EvaluatorSet(address indexed evaluator, bool enabled);
    event OutcomeProposed(
        uint256 indexed thesisId,
        address indexed evaluator,
        Outcome outcome,
        uint64 observedAt,
        int32 returnBps,
        bytes32 evidenceHash,
        uint8 round
    );
    event OutcomeDisputed(uint256 indexed thesisId, address indexed disputer, bytes32 reasonHash, string handle);
    event OutcomeFinalized(uint256 indexed thesisId, Outcome outcome);

    error NotEvaluator();
    error NotRevealed();
    error BadState(State state);
    error BadOutcome();
    error TooEarly();
    error WindowClosed();
    error ObservationOutOfWindow();
    error MaxRounds();
    error NotForfeitable();
    error EvaluatorCannotDispute();

    constructor(IAgentID agentId_, ThesisRegistry registry_, uint64 disputeWindow_, address owner_)
        AgentIdGated(agentId_)
        Ownable(owner_)
    {
        if (address(registry_) == address(0)) revert ZeroAddress();
        registry = registry_;
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

    function attest(uint256 thesisId, Outcome outcome, uint64 observedAt, int32 returnBps, bytes32 evidenceHash)
        external
        onlyEvaluator
    {
        if (outcome == Outcome.None || outcome == Outcome.Forfeited) revert BadOutcome();
        if (!registry.isRevealed(thesisId)) revert NotRevealed();
        ThesisRegistry.Terms memory terms = registry.getTerms(thesisId);

        Attestation storage a = _attestations[thesisId];
        if (a.state != State.None && a.state != State.Disputed) revert BadState(a.state);
        if (a.round >= MAX_ROUNDS) revert MaxRounds();

        if (outcome == Outcome.TargetHit || outcome == Outcome.InvalidationHit) {
            if (observedAt < terms.startTime || observedAt > terms.endTime) revert ObservationOutOfWindow();
            if (observedAt > block.timestamp) revert TooEarly();
        } else if (outcome == Outcome.Expired || outcome == Outcome.Ambiguous) {
            if (block.timestamp < terms.endTime) revert TooEarly();
        }

        a.outcome = outcome;
        a.state = State.Proposed;
        a.round += 1;
        a.evaluator = msg.sender;
        a.proposedAt = uint64(block.timestamp);
        a.observedAt = observedAt;
        a.returnBps = returnBps;
        a.evidenceHash = evidenceHash;
        emit OutcomeProposed(thesisId, msg.sender, outcome, observedAt, returnBps, evidenceHash, a.round);
    }

    function dispute(uint256 thesisId, bytes32 reasonHash) external onlyAgentId {
        Attestation storage a = _attestations[thesisId];
        if (a.state != State.Proposed) revert BadState(a.state);
        if (block.timestamp > a.proposedAt + disputeWindow) revert WindowClosed();
        if (isEvaluator[msg.sender]) revert EvaluatorCannotDispute();
        a.state = State.Disputed;
        emit OutcomeDisputed(thesisId, msg.sender, reasonHash, _handleOf(msg.sender));
    }

    function finalize(uint256 thesisId) external {
        Attestation storage a = _attestations[thesisId];
        if (a.state != State.Proposed) revert BadState(a.state);
        if (block.timestamp <= a.proposedAt + disputeWindow) revert TooEarly();
        a.state = State.Final;
        emit OutcomeFinalized(thesisId, a.outcome);
    }

    /// @notice Permissionless: an unrevealed thesis past its reveal deadline, or one cancelled before
    ///         reveal, is final as Forfeited (counted against the author's record).
    function forfeit(uint256 thesisId) external {
        ThesisRegistry.Thesis memory t = registry.getThesis(thesisId);
        bool expiredUnrevealed = t.status == ThesisRegistry.Status.Committed && block.timestamp > t.revealBy;
        bool cancelledHidden = t.status == ThesisRegistry.Status.Cancelled && t.cancelledBeforeReveal;
        if (!expiredUnrevealed && !cancelledHidden) revert NotForfeitable();
        Attestation storage a = _attestations[thesisId];
        if (a.state == State.Final) revert BadState(a.state);
        a.outcome = Outcome.Forfeited;
        a.state = State.Final;
        a.proposedAt = uint64(block.timestamp);
        emit OutcomeFinalized(thesisId, Outcome.Forfeited);
    }

    function getAttestation(uint256 thesisId) external view returns (Attestation memory) {
        return _attestations[thesisId];
    }
}
