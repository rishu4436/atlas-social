// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {AgentIdGated} from "../src/AgentIdGated.sol";
import {AtlasThesisRegistry as R} from "../src/AtlasThesisRegistry.sol";

contract AtlasThesisRegistryTest is Base {
    bytes32 constant SALT = keccak256("salt");

    function test_publishThesis_storesTermsAndStartsWindowNow() public {
        R.ThesisTerms memory t = longTerms();
        bytes32 c = theses.computeCommitment(alice, t, SALT);
        vm.prank(alice);
        uint256 id = theses.publishThesis(t, SALT);
        assertEq(id, 1);
        R.ThesisRecord memory r = theses.getThesis(id);
        assertEq(r.author, alice);
        assertEq(r.commitment, c);
        assertEq(r.startTime, block.timestamp);
        assertEq(r.agentTokenId, uint256(keccak256("alice")));
        assertEq(uint8(r.status), uint8(R.Status.Published));
        assertEq(theses.getTerms(id).target.price, px(660));
        assertEq(theses.thesisIdByCommitment(c), 1);
        (uint64 s, uint64 e) = theses.observationWindow(id);
        assertEq(s, block.timestamp);
        assertEq(e, t.evaluationDeadline);
        assertTrue(theses.isPublished(id));
        assertEq(theses.authoredCount(alice), 1);
    }

    function test_commitReveal_privateThesis() public {
        R.ThesisTerms memory t = longTerms();
        bytes32 c = theses.computeCommitment(alice, t, SALT);
        vm.prank(alice);
        uint256 id = theses.commitThesis(c, uint64(block.timestamp + 10 days));
        vm.expectRevert(abi.encodeWithSelector(R.BadStatus.selector, R.Status.Committed));
        theses.getTerms(id);
        (, uint64 end) = theses.observationWindow(id);
        assertEq(end, 0);
        vm.warp(block.timestamp + 1 days);
        vm.prank(outsider); // anyone with the salt can reveal
        theses.revealThesis(id, t, SALT);
        assertEq(theses.getThesis(id).startTime, block.timestamp - 1 days); // window started at commit
    }

    function test_revert_revealMismatch() public {
        R.ThesisTerms memory t = longTerms();
        bytes32 c_id = theses.computeCommitment(alice, t, SALT);
        vm.prank(alice);
        uint256 id = theses.commitThesis(c_id, uint64(block.timestamp + 10 days));
        t.target.price = px(700);
        vm.expectRevert(R.CommitmentMismatch.selector);
        theses.revealThesis(id, t, SALT);
    }

    function test_revert_revealAfterDeadline() public {
        R.ThesisTerms memory t = longTerms();
        bytes32 c_id = theses.computeCommitment(alice, t, SALT);
        vm.prank(alice);
        uint256 id = theses.commitThesis(c_id, uint64(block.timestamp + 8 days));
        vm.warp(block.timestamp + 9 days);
        vm.expectRevert(R.RevealWindowClosed.selector);
        theses.revealThesis(id, t, SALT);
    }

    function test_copiedCommitment_cannotBeAttributedToCopier() public {
        R.ThesisTerms memory t = longTerms();
        bytes32 aliceC = theses.computeCommitment(alice, t, SALT);
        vm.prank(bob);
        uint256 id = theses.commitThesis(aliceC, uint64(block.timestamp + 10 days));
        vm.expectRevert(R.CommitmentMismatch.selector);
        theses.revealThesis(id, t, SALT);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R.CommitmentExists.selector, id));
        theses.commitThesis(aliceC, uint64(block.timestamp + 10 days));
    }

    function test_revert_nonHolder() public {
        R.ThesisTerms memory t = longTerms();
        vm.startPrank(outsider);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.NotAgentIdHolder.selector, outsider));
        theses.publishThesis(t, SALT);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.NotAgentIdHolder.selector, outsider));
        theses.commitThesis(keccak256("x"), uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_revert_commitBounds() public {
        vm.startPrank(alice);
        vm.expectRevert(R.EmptyCommitment.selector);
        theses.commitThesis(bytes32(0), uint64(block.timestamp + 1 days));
        vm.expectRevert(R.InvalidRevealDeadline.selector);
        theses.commitThesis(keccak256("a"), uint64(block.timestamp));
        vm.expectRevert(R.InvalidRevealDeadline.selector);
        theses.commitThesis(keccak256("a"), uint64(block.timestamp + 401 days));
        vm.stopPrank();
    }

    function _expectInvalid(R.ThesisTerms memory t, string memory reason) internal {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(R.InvalidTerms.selector, reason));
        theses.publishThesis(t, SALT);
    }

    function test_validation() public {
        R.ThesisTerms memory t;
        t = longTerms(); t.baseAsset = address(0); _expectInvalid(t, "assets");
        t = longTerms(); t.quoteAsset = t.baseAsset; _expectInvalid(t, "assets");
        t = longTerms(); t.methodologyHash = 0; _expectInvalid(t, "methodology");
        t = longTerms(); t.contentHash = 0; _expectInvalid(t, "content");
        t = longTerms(); t.target.price = 0; _expectInvalid(t, "levels");
        t = longTerms(); t.target.comparator = R.Comparator.LTE; _expectInvalid(t, "long comparators");
        t = longTerms(); t.target.price = px(560); t.entry.kind = R.EntryKind.Market; t.entry.price = 0; _expectInvalid(t, "long levels");
        t = longTerms(); t.entry.price = px(700); _expectInvalid(t, "entry");
        t = longTerms(); t.entry.kind = R.EntryKind.Market; _expectInvalid(t, "entry");
        t = longTerms(); t.direction = R.Direction.None; _expectInvalid(t, "direction");
        t = shortTerms(); t.invalidation.comparator = R.Comparator.LTE; _expectInvalid(t, "short comparators");
        t = shortTerms(); t.target.price = px(650); _expectInvalid(t, "short levels");
        t = shortTerms(); t.entry = R.EntryCondition(R.EntryKind.AtOrAbove, px(500)); _expectInvalid(t, "entry");
    }

    function test_validation_deadlines() public {
        R.ThesisTerms memory t = longTerms();
        bytes32 c_id = theses.computeCommitment(alice, t, SALT);
        vm.prank(alice);
        uint256 id = theses.commitThesis(c_id, uint64(block.timestamp + 3 days));
        vm.expectRevert(abi.encodeWithSelector(R.InvalidTerms.selector, "deadline after reveal"));
        theses.revealThesis(id, t, SALT);
        t.evaluationDeadline = uint64(block.timestamp);
        vm.prank(alice);
        vm.expectRevert(R.InvalidRevealDeadline.selector); // publish uses deadline as reveal deadline
        theses.publishThesis(t, SALT);
        // deadline equal to start when revealed later
        R.ThesisTerms memory t2 = longTerms();
        t2.evaluationDeadline = uint64(block.timestamp);
        bytes32 c_id2 = theses.computeCommitment(alice, t2, SALT);
        vm.prank(alice);
        uint256 id2 = theses.commitThesis(c_id2, uint64(block.timestamp + 3 days));
        vm.expectRevert(abi.encodeWithSelector(R.InvalidTerms.selector, "deadline"));
        theses.revealThesis(id2, t2, SALT);
    }

    function test_shortWithMarketEntry_ok() public {
        vm.prank(alice);
        theses.publishThesis(shortTerms(), SALT);
    }

    function test_appendCorrection_appendOnly() public {
        uint256 id = publishAs(alice);
        R.ThesisTerms memory before = theses.getTerms(id);
        vm.startPrank(alice);
        theses.appendCorrection(id, keccak256("typo"));
        theses.appendCorrection(id, keccak256("second"));
        vm.stopPrank();
        assertEq(theses.getThesis(id).corrections, 2);
        assertEq(keccak256(abi.encode(theses.getTerms(id))), keccak256(abi.encode(before)));
        vm.prank(bob);
        vm.expectRevert(R.NotAuthor.selector);
        theses.appendCorrection(id, keccak256("x"));
    }

    function test_cancel_permanentAndPublic() public {
        uint256 id = publishAs(alice);
        vm.prank(bob);
        vm.expectRevert(R.NotAuthor.selector);
        theses.cancelThesis(id);
        vm.prank(alice);
        theses.cancelThesis(id);
        R.ThesisRecord memory r = theses.getThesis(id);
        assertEq(uint8(r.status), uint8(R.Status.Cancelled));
        assertFalse(r.cancelledBeforeReveal);
        assertEq(theses.getTerms(id).target.price, px(660)); // history preserved
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(R.BadStatus.selector, R.Status.Cancelled));
        theses.cancelThesis(id);
        vm.expectRevert(abi.encodeWithSelector(R.BadStatus.selector, R.Status.Cancelled));
        theses.appendCorrection(id, keccak256("x"));
        vm.stopPrank();
    }

    function test_cancelBeforeReveal_flagged() public {
        vm.startPrank(alice);
        uint256 id = theses.commitThesis(keccak256("hidden"), uint64(block.timestamp + 5 days));
        theses.cancelThesis(id);
        vm.stopPrank();
        assertTrue(theses.getThesis(id).cancelledBeforeReveal);
    }

    function test_revert_unknown() public {
        vm.expectRevert(abi.encodeWithSelector(R.UnknownThesis.selector, 9));
        theses.getThesis(9);
        vm.expectRevert(abi.encodeWithSelector(R.UnknownThesis.selector, 9));
        theses.authorOf(9);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_commitmentBindsEveryField(uint128 target, uint128 inv, bytes32 salt, bytes32 salt2, address author)
        public
        view
    {
        vm.assume(salt != salt2);
        R.ThesisTerms memory t = longTerms();
        t.target.price = target;
        t.invalidation.price = inv;
        bytes32 c1 = theses.computeCommitment(author, t, salt);
        assertTrue(c1 != theses.computeCommitment(author, t, salt2));
        t.target.price = target ^ 1;
        assertTrue(c1 != theses.computeCommitment(author, t, salt));
        t.target.price = target;
        if (author != alice) assertTrue(c1 != theses.computeCommitment(alice, t, salt));
    }

    function testFuzz_longLevelsValidated(uint128 target, uint128 inv, uint32 horizon) public {
        target = uint128(bound(target, 1, type(uint128).max));
        inv = uint128(bound(inv, 1, type(uint128).max));
        horizon = uint32(bound(horizon, 1, 400 days));
        R.ThesisTerms memory t = longTerms();
        t.entry = R.EntryCondition(R.EntryKind.Market, 0);
        t.target.price = target;
        t.invalidation.price = inv;
        t.evaluationDeadline = uint64(block.timestamp + horizon);
        vm.prank(alice);
        if (target <= inv) {
            vm.expectRevert(abi.encodeWithSelector(R.InvalidTerms.selector, "long levels"));
            theses.publishThesis(t, SALT);
        } else {
            uint256 id = theses.publishThesis(t, SALT);
            assertEq(theses.getTerms(id).target.price, target);
        }
    }

    function testFuzz_onlyMatchingRevealSucceeds(bytes32 salt, bytes32 wrongSalt) public {
        vm.assume(salt != wrongSalt);
        R.ThesisTerms memory t = longTerms();
        bytes32 c_id = theses.computeCommitment(bob, t, salt);
        vm.prank(bob);
        uint256 id = theses.commitThesis(c_id, uint64(block.timestamp + 30 days));
        vm.expectRevert(R.CommitmentMismatch.selector);
        theses.revealThesis(id, t, wrongSalt);
        theses.revealThesis(id, t, salt);
        assertTrue(theses.isPublished(id));
    }
}
