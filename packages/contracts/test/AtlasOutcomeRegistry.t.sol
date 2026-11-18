// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AgentIdGated} from "../src/AgentIdGated.sol";
import {AtlasOutcomeRegistry as O} from "../src/AtlasOutcomeRegistry.sol";
import {AtlasThesisRegistry} from "../src/AtlasThesisRegistry.sol";
import {IAgentID} from "../src/interfaces/IAgentID.sol";

contract AtlasOutcomeRegistryTest is Base {
    bytes32 constant EV = keccak256("evidence.json");
    uint256 id;
    uint64 start;
    uint64 end;

    function setUp() public override {
        super.setUp();
        id = publishAs(alice);
        (start, end) = theses.observationWindow(id);
    }

    function test_evaluatorManagement_ownerOnly() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        outcomes.setEvaluator(bob, true);
        vm.startPrank(owner);
        outcomes.setEvaluator(bob, true);
        outcomes.setEvaluator(bob, true);
        assertEq(outcomes.evaluatorCount(), 2);
        outcomes.setEvaluator(bob, false);
        assertEq(outcomes.evaluatorCount(), 1);
        vm.expectRevert(AgentIdGated.ZeroAddress.selector);
        outcomes.setEvaluator(address(0), true);
        outcomes.transferOwnership(bob);
        vm.stopPrank();
        assertEq(outcomes.owner(), owner);
        vm.prank(bob);
        outcomes.acceptOwnership();
        assertEq(outcomes.owner(), bob);
    }

    function test_targetHit_finalizesAfterWindow() public {
        uint64 at = start + 3 hours;
        vm.warp(at + 60);
        vm.prank(evaluator);
        outcomes.proposeOutcome(id, O.Outcome.TargetHit, at, px(661), EV);
        vm.expectRevert(O.TooEarly.selector);
        outcomes.finalizeOutcome(id);
        vm.warp(block.timestamp + DISPUTE + 1);
        outcomes.finalizeOutcome(id);
        O.Attestation memory a = outcomes.getAttestation(id);
        assertEq(uint8(a.state), uint8(O.State.Final));
        assertEq(uint8(a.outcome), uint8(O.Outcome.TargetHit));
        assertEq(outcomes.finalizedCount(), 1);
        vm.prank(evaluator);
        vm.expectRevert(abi.encodeWithSelector(O.BadState.selector, O.State.Final));
        outcomes.proposeOutcome(id, O.Outcome.Expired, 0, 0, EV);
    }

    function test_proposeGuards() public {
        vm.prank(alice);
        vm.expectRevert(O.NotEvaluator.selector);
        outcomes.proposeOutcome(id, O.Outcome.TargetHit, start, 1, EV);
        vm.startPrank(evaluator);
        vm.expectRevert(O.BadOutcome.selector);
        outcomes.proposeOutcome(id, O.Outcome.None, 0, 0, EV);
        vm.expectRevert(O.BadOutcome.selector);
        outcomes.proposeOutcome(id, O.Outcome.Forfeited, 0, 0, EV);
        vm.expectRevert(O.BadOutcome.selector);
        outcomes.proposeOutcome(id, O.Outcome.Void, 0, 0, 0);
        vm.expectRevert(O.ObservationOutOfWindow.selector);
        outcomes.proposeOutcome(id, O.Outcome.TargetHit, start - 1, 1, EV);
        vm.expectRevert(O.ObservationOutOfWindow.selector);
        outcomes.proposeOutcome(id, O.Outcome.TargetHit, end + 1, 1, EV);
        vm.expectRevert(O.TooEarly.selector);
        outcomes.proposeOutcome(id, O.Outcome.TargetHit, start + 100, 1, EV);
        vm.expectRevert(O.TooEarly.selector);
        outcomes.proposeOutcome(id, O.Outcome.Expired, 0, 0, EV);
        vm.expectRevert(O.TooEarly.selector);
        outcomes.proposeOutcome(id, O.Outcome.Unresolved, 0, 0, EV);
        vm.warp(start + 1 hours);
        vm.expectRevert(O.BadOutcome.selector);
        outcomes.proposeOutcome(id, O.Outcome.TargetHit, start + 10, 0, EV);
        vm.stopPrank();
        vm.prank(alice);
        uint256 hidden = theses.commitThesis(keccak256("h"), uint64(block.timestamp + 5 days));
        vm.prank(evaluator);
        vm.expectRevert(O.NotPublished.selector);
        outcomes.proposeOutcome(hidden, O.Outcome.Void, 0, 0, EV);
    }

    function test_missingData_unresolvedAfterDeadline() public {
        vm.warp(end + 1);
        vm.prank(evaluator);
        outcomes.proposeOutcome(id, O.Outcome.Unresolved, 0, 0, EV);
        vm.warp(block.timestamp + DISPUTE + 1);
        outcomes.finalizeOutcome(id);
        assertEq(uint8(outcomes.getAttestation(id).outcome), uint8(O.Outcome.Unresolved));
    }

    function test_challenge_requiresReproposal_maxRounds() public {
        vm.warp(end + 1);
        vm.prank(evaluator);
        outcomes.proposeOutcome(id, O.Outcome.Expired, 0, 0, EV);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.NotAgentIdHolder.selector, outsider));
        outcomes.challengeOutcome(id, keccak256("r"));
        vm.prank(bob);
        outcomes.challengeOutcome(id, keccak256("wrong candle"));
        vm.expectRevert(abi.encodeWithSelector(O.BadState.selector, O.State.Challenged));
        outcomes.finalizeOutcome(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(O.BadState.selector, O.State.Challenged));
        outcomes.challengeOutcome(id, 0);
        for (uint256 i; i < 2; i++) {
            vm.prank(evaluator);
            outcomes.proposeOutcome(id, O.Outcome.Unresolved, 0, 0, EV);
            vm.prank(bob);
            outcomes.challengeOutcome(id, 0);
        }
        vm.prank(evaluator);
        vm.expectRevert(O.MaxRounds.selector);
        outcomes.proposeOutcome(id, O.Outcome.Unresolved, 0, 0, EV);
    }

    function test_challengeWindow_andEvaluatorSelfChallenge() public {
        agent.registerFor(evaluator, "evaluator");
        vm.warp(end + 1);
        vm.prank(evaluator);
        outcomes.proposeOutcome(id, O.Outcome.Expired, 0, 0, EV);
        vm.prank(evaluator);
        vm.expectRevert(O.EvaluatorCannotChallenge.selector);
        outcomes.challengeOutcome(id, 0);
        vm.warp(block.timestamp + DISPUTE + 1);
        vm.prank(bob);
        vm.expectRevert(O.WindowClosed.selector);
        outcomes.challengeOutcome(id, 0);
    }

    function test_forfeit_hiddenExpiredAndHiddenCancelled() public {
        vm.startPrank(alice);
        uint256 h1 = theses.commitThesis(keccak256("h1"), uint64(block.timestamp + 2 days));
        uint256 h2 = theses.commitThesis(keccak256("h2"), uint64(block.timestamp + 20 days));
        theses.cancelThesis(h2);
        vm.stopPrank();
        vm.expectRevert(O.NotForfeitable.selector);
        outcomes.forfeit(h1);
        vm.warp(block.timestamp + 3 days);
        outcomes.forfeit(h1);
        outcomes.forfeit(h2);
        assertEq(uint8(outcomes.getAttestation(h1).outcome), uint8(O.Outcome.Forfeited));
        assertEq(uint8(outcomes.getAttestation(h2).outcome), uint8(O.Outcome.Forfeited));
        vm.expectRevert(abi.encodeWithSelector(O.BadState.selector, O.State.Final));
        outcomes.forfeit(h1);
        vm.expectRevert(O.NotForfeitable.selector);
        outcomes.forfeit(id); // published theses are evaluated, never forfeited
    }

    function test_revert_zeroRegistry() public {
        vm.expectRevert(AgentIdGated.ZeroAddress.selector);
        new O(IAgentID(address(agent)), AtlasThesisRegistry(address(0)), 1 days, owner);
    }

    function testFuzz_observationMustBeInWindow(uint64 at) public {
        vm.warp(end + 1);
        vm.prank(evaluator);
        if (at < start || at > end) {
            vm.expectRevert(O.ObservationOutOfWindow.selector);
            outcomes.proposeOutcome(id, O.Outcome.InvalidationHit, at, px(560), EV);
        } else {
            outcomes.proposeOutcome(id, O.Outcome.InvalidationHit, at, px(560), EV);
            assertEq(outcomes.getAttestation(id).observedAt, at);
        }
    }
}
