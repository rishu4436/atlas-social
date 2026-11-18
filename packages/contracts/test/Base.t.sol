// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockAgentID} from "../src/mocks/MockAgentID.sol";
import {IAgentID} from "../src/interfaces/IAgentID.sol";
import {AtlasIdentityRegistry} from "../src/AtlasIdentityRegistry.sol";
import {AtlasThesisRegistry} from "../src/AtlasThesisRegistry.sol";
import {AtlasReviewRegistry} from "../src/AtlasReviewRegistry.sol";
import {AtlasOutcomeRegistry} from "../src/AtlasOutcomeRegistry.sol";

abstract contract Base is Test {
    MockAgentID internal agent;
    AtlasIdentityRegistry internal identity;
    AtlasThesisRegistry internal theses;
    AtlasReviewRegistry internal reviews;
    AtlasOutcomeRegistry internal outcomes;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal evaluator = makeAddr("evaluator");
    address internal outsider = makeAddr("outsider");

    address internal constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address internal constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    bytes32 internal constant METHOD = keccak256("ATLAS-M1 Binance spot 1h klines high/low touch");
    uint64 internal constant DISPUTE = 2 days;

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        agent = new MockAgentID();
        agent.registerFor(alice, "alice");
        agent.registerFor(bob, "bob");
        agent.registerFor(carol, "carol");
        identity = new AtlasIdentityRegistry(IAgentID(address(agent)));
        theses = new AtlasThesisRegistry(IAgentID(address(agent)));
        reviews = new AtlasReviewRegistry(IAgentID(address(agent)), theses);
        outcomes = new AtlasOutcomeRegistry(IAgentID(address(agent)), theses, DISPUTE, owner);
        vm.prank(owner);
        outcomes.setEvaluator(evaluator, true);
    }

    function px(uint256 whole) internal pure returns (uint128) {
        return uint128(whole * 1e8);
    }

    function longTerms() internal view returns (AtlasThesisRegistry.ThesisTerms memory t) {
        t.baseAsset = WBNB;
        t.quoteAsset = USDT;
        t.direction = AtlasThesisRegistry.Direction.Long;
        t.entry = AtlasThesisRegistry.EntryCondition(AtlasThesisRegistry.EntryKind.AtOrBelow, px(600));
        t.target = AtlasThesisRegistry.PriceCondition(AtlasThesisRegistry.Comparator.GTE, px(660));
        t.invalidation = AtlasThesisRegistry.PriceCondition(AtlasThesisRegistry.Comparator.LTE, px(570));
        t.evaluationDeadline = uint64(block.timestamp + 7 days);
        t.methodologyHash = METHOD;
        t.contentHash = keccak256("BNB breakout thesis");
    }

    function shortTerms() internal view returns (AtlasThesisRegistry.ThesisTerms memory t) {
        t = longTerms();
        t.direction = AtlasThesisRegistry.Direction.Short;
        t.entry = AtlasThesisRegistry.EntryCondition(AtlasThesisRegistry.EntryKind.Market, 0);
        t.target = AtlasThesisRegistry.PriceCondition(AtlasThesisRegistry.Comparator.LTE, px(520));
        t.invalidation = AtlasThesisRegistry.PriceCondition(AtlasThesisRegistry.Comparator.GTE, px(640));
    }

    function publishAs(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = theses.publishThesis(longTerms(), keccak256(abi.encode(who, block.timestamp)));
    }
}
