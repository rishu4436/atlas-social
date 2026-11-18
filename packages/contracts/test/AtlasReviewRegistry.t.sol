// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {AgentIdGated} from "../src/AgentIdGated.sol";
import {AtlasReviewRegistry as RR} from "../src/AtlasReviewRegistry.sol";
import {AtlasThesisRegistry} from "../src/AtlasThesisRegistry.sol";
import {IAgentID} from "../src/interfaces/IAgentID.sol";

contract AtlasReviewRegistryTest is Base {
    uint256 id;

    function setUp() public override {
        super.setUp();
        id = publishAs(alice);
    }

    function test_publishReview() public {
        vm.prank(bob);
        uint256 rid = reviews.publishReview(id, RR.Stance.Endorse, keccak256("solid"));
        RR.Review memory r = reviews.getReview(rid);
        assertEq(r.reviewer, bob);
        assertEq(r.thesisId, id);
        assertEq(uint8(r.stance), uint8(RR.Stance.Endorse));
        assertEq(reviews.reviewIdOf(id, bob), rid);
        vm.prank(carol);
        reviews.publishReview(id, RR.Stance.Dispute, keccak256("weak volume"));
        (uint256 e, uint256 d, uint256 n) = reviews.stanceCounts(id);
        assertEq(e, 1);
        assertEq(d, 1);
        assertEq(n, 0);
    }

    function test_revert_reviewRules() public {
        vm.prank(alice);
        vm.expectRevert(RR.SelfReview.selector);
        reviews.publishReview(id, RR.Stance.Endorse, 0);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.NotAgentIdHolder.selector, outsider));
        reviews.publishReview(id, RR.Stance.Endorse, 0);
        vm.prank(bob);
        vm.expectRevert(RR.InvalidStance.selector);
        reviews.publishReview(id, RR.Stance.None, 0);
        vm.prank(bob);
        uint256 rid = reviews.publishReview(id, RR.Stance.Neutral, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RR.AlreadyReviewed.selector, rid));
        reviews.publishReview(id, RR.Stance.Dispute, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AtlasThesisRegistry.UnknownThesis.selector, 99));
        reviews.publishReview(99, RR.Stance.Endorse, 0);
    }

    function test_challengeEvidence() public {
        bytes32 ev = keccak256("tx-proof-0xabc");
        vm.prank(bob);
        uint256 cid = reviews.challengeEvidence(id, RR.EvidenceKind.TradeProof, ev, keccak256("not the author's wallet"));
        RR.Challenge memory c = reviews.getChallenge(cid);
        assertEq(c.challenger, bob);
        assertEq(c.evidenceHash, ev);
        assertEq(reviews.challengesOnThesis(id), 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RR.AlreadyChallenged.selector, cid));
        reviews.challengeEvidence(id, RR.EvidenceKind.TradeProof, ev, 0);
        vm.prank(bob); // a different evidence item is fine
        reviews.challengeEvidence(id, RR.EvidenceKind.MarketData, ev, 0);
        vm.prank(carol);
        reviews.challengeEvidence(id, RR.EvidenceKind.TradeProof, ev, 0);
        assertEq(reviews.challengesOnThesis(id), 3);
    }

    function test_revert_challengeRules() public {
        vm.prank(bob);
        vm.expectRevert(RR.InvalidEvidence.selector);
        reviews.challengeEvidence(id, RR.EvidenceKind.None, keccak256("x"), 0);
        vm.prank(bob);
        vm.expectRevert(RR.InvalidEvidence.selector);
        reviews.challengeEvidence(id, RR.EvidenceKind.TradeProof, 0, 0);
        vm.prank(alice);
        vm.expectRevert(RR.SelfReview.selector);
        reviews.challengeEvidence(id, RR.EvidenceKind.TradeProof, keccak256("x"), 0);
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.NotAgentIdHolder.selector, outsider));
        reviews.challengeEvidence(id, RR.EvidenceKind.TradeProof, keccak256("x"), 0);
    }

    function test_revert_zeroThesisRegistry() public {
        vm.expectRevert(AgentIdGated.ZeroAddress.selector);
        new RR(IAgentID(address(agent)), AtlasThesisRegistry(address(0)));
    }

    function testFuzz_oneReviewPerHolder(uint8 s1, uint8 s2) public {
        RR.Stance a = RR.Stance(bound(s1, 1, 3));
        RR.Stance b = RR.Stance(bound(s2, 1, 3));
        vm.prank(carol);
        reviews.publishReview(id, a, keccak256("1"));
        vm.prank(carol);
        vm.expectRevert();
        reviews.publishReview(id, b, keccak256("2"));
        (uint256 e, uint256 d, uint256 n) = reviews.stanceCounts(id);
        assertEq(e + d + n, 1);
    }
}
