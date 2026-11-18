// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Base} from "./Base.t.sol";
import {AtlasThesisRegistry as R} from "../src/AtlasThesisRegistry.sol";
import {AtlasOutcomeRegistry as O} from "../src/AtlasOutcomeRegistry.sol";
import {AtlasReviewRegistry as RR} from "../src/AtlasReviewRegistry.sol";
import {AtlasIdentityRegistry} from "../src/AtlasIdentityRegistry.sol";

/// @dev Random actor drives every state-changing entrypoint; ghost state records what must never change.
contract Handler is Test {
    R public theses;
    O public outcomes;
    RR public reviews;
    AtlasIdentityRegistry public identity;
    address[] public actors;
    address public evaluator;

    mapping(uint256 => bytes32) public publishedTermsHash;
    mapping(uint256 => uint8) public finalOutcome;
    mapping(uint256 => bool) public isFinal;
    mapping(bytes32 => address) public firstUserOfCommitment;
    bytes32[] public usedCommitments;
    uint256[] public finalIds;
    uint256 public calls;

    constructor(R t, O o, RR r, AtlasIdentityRegistry i, address[] memory a, address e) {
        theses = t;
        outcomes = o;
        reviews = r;
        identity = i;
        actors = a;
        evaluator = e;
    }

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function _terms(uint256 seed) internal view returns (R.ThesisTerms memory t) {
        uint128 inv = uint128(bound(seed, 1e8, 1e14));
        t.baseAsset = address(0xB0B);
        t.quoteAsset = address(0xCAFE);
        t.direction = R.Direction.Long;
        t.entry = R.EntryCondition(R.EntryKind.Market, 0);
        t.target = R.PriceCondition(R.Comparator.GTE, inv * 2);
        t.invalidation = R.PriceCondition(R.Comparator.LTE, inv);
        t.evaluationDeadline = uint64(block.timestamp + 1 + (seed % 30 days));
        t.methodologyHash = keccak256("m");
        t.contentHash = keccak256(abi.encode(seed));
    }

    function publish(uint256 a, uint256 seed) external {
        calls++;
        address who = _actor(a);
        R.ThesisTerms memory t = _terms(seed);
        vm.prank(who);
        try theses.publishThesis(t, bytes32(seed)) returns (uint256 id) {
            publishedTermsHash[id] = keccak256(abi.encode(t));
        } catch {}
    }

    function commitAndMaybeReveal(uint256 a, uint256 seed, bool doReveal) external {
        calls++;
        address who = _actor(a);
        R.ThesisTerms memory t = _terms(seed);
        bytes32 c = theses.computeCommitment(who, t, bytes32(seed));
        vm.prank(who);
        try theses.commitThesis(c, uint64(block.timestamp + 31 days)) returns (uint256 id) {
            if (doReveal) {
                try theses.revealThesis(id, t, bytes32(seed)) {
                    publishedTermsHash[id] = keccak256(abi.encode(t));
                } catch {}
            }
        } catch {}
    }

    function cancel(uint256 a, uint256 idSeed) external {
        calls++;
        uint256 n = theses.thesisCount();
        if (n == 0) return;
        vm.prank(_actor(a));
        try theses.cancelThesis(1 + (idSeed % n)) {} catch {}
    }

    function correct(uint256 a, uint256 idSeed) external {
        calls++;
        uint256 n = theses.thesisCount();
        if (n == 0) return;
        vm.prank(_actor(a));
        try theses.appendCorrection(1 + (idSeed % n), keccak256(abi.encode(idSeed))) {} catch {}
    }

    function review(uint256 a, uint256 idSeed, uint8 stance) external {
        calls++;
        uint256 n = theses.thesisCount();
        if (n == 0) return;
        vm.prank(_actor(a));
        try reviews.publishReview(1 + (idSeed % n), RR.Stance(bound(stance, 1, 3)), bytes32(0)) {} catch {}
    }

    function warp(uint256 secs) external {
        calls++;
        vm.warp(block.timestamp + bound(secs, 1, 10 days));
    }

    function propose(uint256 idSeed, uint8 kind) external {
        calls++;
        uint256 n = theses.thesisCount();
        if (n == 0) return;
        uint256 id = 1 + (idSeed % n);
        O.Outcome o = O.Outcome(bound(kind, 3, 5)); // Expired, Unresolved, Void
        vm.prank(evaluator);
        try outcomes.proposeOutcome(id, o, 0, 0, keccak256("ev")) {} catch {}
    }

    function challenge(uint256 a, uint256 idSeed) external {
        calls++;
        uint256 n = theses.thesisCount();
        if (n == 0) return;
        vm.prank(_actor(a));
        try outcomes.challengeOutcome(1 + (idSeed % n), bytes32(0)) {} catch {}
    }

    function finalizeOrForfeit(uint256 idSeed) external {
        calls++;
        uint256 n = theses.thesisCount();
        if (n == 0) return;
        uint256 id = 1 + (idSeed % n);
        try outcomes.finalizeOutcome(id) {} catch {}
        try outcomes.forfeit(id) {} catch {}
        O.Attestation memory att = outcomes.getAttestation(id);
        if (att.state == O.State.Final && !isFinal[id]) {
            isFinal[id] = true;
            finalOutcome[id] = uint8(att.outcome);
            finalIds.push(id);
        }
    }

    function login(uint256 a, bytes32 c) external {
        calls++;
        address who = _actor(a);
        vm.prank(who);
        try identity.registerIdentity(c) {
            if (firstUserOfCommitment[c] == address(0)) {
                firstUserOfCommitment[c] = who;
                usedCommitments.push(c);
            }
        } catch {}
    }

    function finalCount() external view returns (uint256) {
        return finalIds.length;
    }

    function usedCount() external view returns (uint256) {
        return usedCommitments.length;
    }
}

contract AtlasInvariants is StdInvariant, Base {
    Handler handler;
    address[] actors;

    function setUp() public override {
        super.setUp();
        actors.push(alice);
        actors.push(bob);
        actors.push(carol);
        actors.push(outsider);
        handler = new Handler(theses, outcomes, reviews, identity, actors, evaluator);
        targetContract(address(handler));
    }

    /// Published terms are immutable: on-chain terms always equal what was originally published.
    function invariant_publishedTermsNeverChange() public view {
        uint256 n = theses.thesisCount();
        for (uint256 i = 1; i <= n; i++) {
            bytes32 h = handler.publishedTermsHash(i);
            if (h != bytes32(0)) assertEq(keccak256(abi.encode(theses.getTerms(i))), h);
        }
    }

    /// Every thesis is reachable from its commitment and authored by an Agent ID holder (never the outsider).
    function invariant_commitmentIndexAndAuthorship() public view {
        uint256 n = theses.thesisCount();
        uint256 sum = theses.authoredCount(alice) + theses.authoredCount(bob) + theses.authoredCount(carol);
        assertEq(sum, n);
        assertEq(theses.authoredCount(outsider), 0);
        for (uint256 i = 1; i <= n; i++) {
            R.ThesisRecord memory r = theses.getThesis(i);
            assertEq(theses.thesisIdByCommitment(r.commitment), i);
            assertTrue(r.author != outsider);
        }
    }

    /// Final outcomes never change.
    function invariant_finalOutcomesImmutable() public view {
        uint256 n = handler.finalCount();
        for (uint256 k; k < n; k++) {
            uint256 id = handler.finalIds(k);
            O.Attestation memory a = outcomes.getAttestation(id);
            assertEq(uint8(a.state), uint8(O.State.Final));
            assertEq(uint8(a.outcome), handler.finalOutcome(id));
        }
    }

    /// Login commitments are single use and never re-assigned.
    function invariant_loginCommitmentsSingleUse() public view {
        uint256 n = handler.usedCount();
        for (uint256 k; k < n; k++) {
            bytes32 c = handler.usedCommitments(k);
            assertEq(identity.commitmentUsedBy(c), handler.firstUserOfCommitment(c));
        }
        assertEq(identity.commitmentUsedBy(bytes32(0)), address(0));
    }

    /// Reviews are never authored by the thesis author and at most one per holder per thesis.
    function invariant_reviewCountsBounded() public view {
        uint256 n = theses.thesisCount();
        for (uint256 i = 1; i <= n; i++) {
            (uint256 e, uint256 d, uint256 nn) = reviews.stanceCounts(i);
            assertLe(e + d + nn, 2); // 3 holders minus the author
        }
    }
}
