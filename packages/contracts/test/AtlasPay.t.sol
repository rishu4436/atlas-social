// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockAgentID} from "../src/mocks/MockAgentID.sol";
import {MockStable, FeeOnTransferToken} from "../src/mocks/MockStable.sol";
import {IAgentID} from "../src/interfaces/IAgentID.sol";
import {AgentIdGated} from "../src/AgentIdGated.sol";
import {AtlasPay} from "../src/AtlasPay.sol";

/// Recipient that tries to re-enter AtlasPay while receiving BNB.
contract Reenterer {
    AtlasPay public pay;
    uint256 public targetToken;
    address public targetOwner;
    bool public attempted;

    function arm(AtlasPay p, uint256 t, address o) external {
        pay = p;
        targetToken = t;
        targetOwner = o;
    }

    receive() external payable {
        if (!attempted) {
            attempted = true;
            pay.payNative{value: msg.value}(
                AtlasPay.Payment(targetToken, targetOwner, AtlasPay.Kind.Direct, bytes32(0), bytes32(0))
            );
        }
    }
}

/// Recipient contract that refuses BNB.
contract Refuser {
    receive() external payable {
        revert("no");
    }
}

contract AtlasPayTest is Test {
    MockAgentID internal agent;
    MockStable internal usdt;
    AtlasPay internal pay;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal outsider = makeAddr("outsider");
    uint256 internal aliceId = uint256(keccak256("alice"));
    uint256 internal bobId = uint256(keccak256("bob"));
    bytes32 internal constant CTX = keccak256("post:4b1e7c9e-0000-4000-8000-000000000001");
    bytes32 internal constant MEMO = keccak256("thanks for the BNB thesis");

    event PaymentSent(
        address indexed sender,
        address indexed recipient,
        bytes32 indexed contextRef,
        uint256 senderTokenId,
        uint256 recipientTokenId,
        address token,
        uint256 amount,
        AtlasPay.Kind kind,
        bytes32 memoHash
    );

    function setUp() public {
        agent = new MockAgentID();
        agent.registerFor(alice, "alice");
        agent.registerFor(bob, "bob");
        usdt = new MockStable();
        pay = new AtlasPay(IAgentID(address(agent)), IERC20(address(usdt)));
        vm.deal(alice, 100 ether);
        vm.deal(outsider, 100 ether);
        usdt.mint(alice, 1_000_000e18);
    }

    function p(uint256 id, address to, AtlasPay.Kind k) internal pure returns (AtlasPay.Payment memory) {
        return AtlasPay.Payment(id, to, k, CTX, MEMO);
    }

    // ------------------------------------------------------------------ BNB
    function test_payNative_forwardsToRecipientAndEmitsReceipt() public {
        uint256 before = bob.balance;
        vm.expectEmit(true, true, true, true, address(pay));
        emit PaymentSent(alice, bob, CTX, aliceId, bobId, address(0), 0.25 ether, AtlasPay.Kind.Tip, MEMO);
        vm.prank(alice);
        pay.payNative{value: 0.25 ether}(p(bobId, bob, AtlasPay.Kind.Tip));
        assertEq(bob.balance - before, 0.25 ether);
        assertEq(address(pay).balance, 0, "never holds BNB");
    }

    function test_payNative_rejectsZero() public {
        vm.prank(alice);
        vm.expectRevert(AtlasPay.ZeroAmount.selector);
        pay.payNative(p(bobId, bob, AtlasPay.Kind.Direct));
    }

    function test_senderMustHoldAgentId() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.NotAgentIdHolder.selector, outsider));
        pay.payNative{value: 1 ether}(p(bobId, bob, AtlasPay.Kind.Direct));
    }

    function test_unknownRecipientAgentId() public {
        uint256 ghost = uint256(keccak256("nobody"));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AtlasPay.RecipientNotFound.selector, ghost));
        pay.payNative{value: 1 ether}(p(ghost, bob, AtlasPay.Kind.Direct));
    }

    function test_recipientResolvedAtExecution_revokedAfterPreview() public {
        // UI previewed bob; bob's Agent ID is revoked before execution → nothing is sent
        vm.prank(bob);
        agent.revoke();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AtlasPay.RecipientNotFound.selector, bobId));
        pay.payNative{value: 1 ether}(p(bobId, bob, AtlasPay.Kind.Direct));
    }

    function test_expectedRecipientMustMatchLiveOwner() public {
        address shown = makeAddr("stale-cache");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AtlasPay.RecipientChanged.selector, shown, bob));
        pay.payNative{value: 1 ether}(p(bobId, shown, AtlasPay.Kind.Direct));
    }

    function test_noSelfPayment() public {
        vm.prank(alice);
        vm.expectRevert(AtlasPay.SelfPayment.selector);
        pay.payNative{value: 1 ether}(p(aliceId, alice, AtlasPay.Kind.Direct));
    }

    function test_refusingRecipientRevertsWholePayment() public {
        Refuser r = new Refuser();
        agent.registerFor(address(r), "refuser");
        uint256 before = alice.balance;
        vm.prank(alice);
        vm.expectRevert(AtlasPay.NativeTransferFailed.selector);
        pay.payNative{value: 1 ether}(p(uint256(keccak256("refuser")), address(r), AtlasPay.Kind.Direct));
        assertEq(alice.balance, before);
        assertEq(address(pay).balance, 0);
    }

    function test_reentrancyIsBlocked() public {
        Reenterer r = new Reenterer();
        agent.registerFor(address(r), "reenter");
        r.arm(pay, bobId, bob);
        vm.prank(alice);
        // the nested payNative hits nonReentrant → the BNB transfer fails → whole payment reverts
        vm.expectRevert(AtlasPay.NativeTransferFailed.selector);
        pay.payNative{value: 1 ether}(p(uint256(keccak256("reenter")), address(r), AtlasPay.Kind.Direct));
        assertEq(address(pay).balance, 0);
    }

    function test_cannotReceivePlainBNB() public {
        vm.prank(alice);
        (bool ok,) = address(pay).call{value: 1 ether}("");
        assertFalse(ok, "no receive/fallback");
        assertEq(address(pay).balance, 0);
    }

    function test_recipientOf() public view {
        assertEq(pay.recipientOf(bobId), bob);
    }

    // ------------------------------------------------------------------ USDT
    function test_payToken_exactApproval_noRetainedBalance() public {
        vm.startPrank(alice);
        usdt.approve(address(pay), 10e18);
        vm.expectEmit(true, true, true, true, address(pay));
        emit PaymentSent(alice, bob, CTX, aliceId, bobId, address(usdt), 10e18, AtlasPay.Kind.Request, MEMO);
        pay.payToken(IERC20(address(usdt)), 10e18, p(bobId, bob, AtlasPay.Kind.Request));
        vm.stopPrank();
        assertEq(usdt.balanceOf(bob), 10e18);
        assertEq(usdt.balanceOf(address(pay)), 0);
        assertEq(usdt.allowance(alice, address(pay)), 0, "exact approval fully consumed");
    }

    function test_payToken_insufficientApprovalReverts() public {
        vm.startPrank(alice);
        usdt.approve(address(pay), 9e18);
        vm.expectRevert();
        pay.payToken(IERC20(address(usdt)), 10e18, p(bobId, bob, AtlasPay.Kind.Direct));
        vm.stopPrank();
    }

    function test_payToken_onlyTheConfiguredStable() public {
        MockStable other = new MockStable();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AtlasPay.UnsupportedToken.selector, address(other)));
        pay.payToken(IERC20(address(other)), 1, p(bobId, bob, AtlasPay.Kind.Direct));
    }

    function test_payToken_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(AtlasPay.ZeroAmount.selector);
        pay.payToken(IERC20(address(usdt)), 0, p(bobId, bob, AtlasPay.Kind.Direct));
    }

    function test_payToken_feeOnTransferRejected() public {
        FeeOnTransferToken fee = new FeeOnTransferToken();
        AtlasPay p2 = new AtlasPay(IAgentID(address(agent)), IERC20(address(fee)));
        fee.mint(alice, 100e18);
        vm.startPrank(alice);
        fee.approve(address(p2), 100e18);
        vm.expectRevert(abi.encodeWithSelector(AtlasPay.TokenAmountMismatch.selector, 100e18, 99e18));
        p2.payToken(IERC20(address(fee)), 100e18, p(bobId, bob, AtlasPay.Kind.Direct));
        vm.stopPrank();
    }

    function test_constructorRejectsZero() public {
        vm.expectRevert(AgentIdGated.ZeroAddress.selector);
        new AtlasPay(IAgentID(address(agent)), IERC20(address(0)));
        vm.expectRevert(AgentIdGated.ZeroAddress.selector);
        new AtlasPay(IAgentID(address(0)), IERC20(address(usdt)));
    }

    // ------------------------------------------------------------------ fuzz
    function testFuzz_payNative_conservesValue(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(alice, amount);
        uint256 a0 = alice.balance;
        uint256 b0 = bob.balance;
        vm.prank(alice);
        pay.payNative{value: amount}(p(bobId, bob, AtlasPay.Kind.Direct));
        assertEq(a0 - alice.balance, amount);
        assertEq(bob.balance - b0, amount);
        assertEq(address(pay).balance, 0);
    }

    function testFuzz_payToken_exactAmount(uint128 amount) public {
        amount = uint128(bound(amount, 1, 1_000_000e18));
        uint256 a0 = usdt.balanceOf(alice);
        vm.startPrank(alice);
        usdt.approve(address(pay), amount);
        pay.payToken(IERC20(address(usdt)), amount, p(bobId, bob, AtlasPay.Kind.Tip));
        vm.stopPrank();
        assertEq(a0 - usdt.balanceOf(alice), amount);
        assertEq(usdt.balanceOf(bob), amount);
        assertEq(usdt.balanceOf(address(pay)), 0);
        assertEq(usdt.allowance(alice, address(pay)), 0);
    }

    function testFuzz_wrongExpectedRecipientNeverPays(address shown, uint96 amount) public {
        vm.assume(shown != bob && amount > 0);
        vm.deal(alice, amount);
        uint256 b0 = bob.balance;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AtlasPay.RecipientChanged.selector, shown, bob));
        pay.payNative{value: amount}(p(bobId, shown, AtlasPay.Kind.Direct));
        assertEq(bob.balance, b0);
    }

    function testFuzz_unknownTokenIdNeverPays(uint256 tokenId) public {
        vm.assume(tokenId != aliceId && tokenId != bobId);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AtlasPay.RecipientNotFound.selector, tokenId));
        pay.payNative{value: 1}(p(tokenId, bob, AtlasPay.Kind.Direct));
    }
}

// ---------------------------------------------------------------------- invariants

contract PayHandler is Test {
    AtlasPay public pay;
    MockStable public usdt;
    address[] public actors; // first 3 hold Agent IDs, last does not
    uint256[] public ids;
    uint256 public okPayments;
    uint256 public totalNative;
    uint256 public ghostMinted;

    constructor(AtlasPay p, MockStable u, address[] memory a, uint256[] memory i) {
        pay = p;
        usdt = u;
        actors = a;
        ids = i;
    }

    function payNative(uint256 s, uint256 r, uint96 amount, bool wrongShown) external {
        address from = actors[s % actors.length];
        uint256 idx = r % ids.length;
        address shown = wrongShown ? address(0xBAD) : actors[idx];
        amount = uint96(bound(amount, 0, 5 ether));
        vm.deal(from, from.balance + amount);
        vm.prank(from);
        try pay.payNative{value: amount}(
            AtlasPay.Payment(ids[idx], shown, AtlasPay.Kind.Direct, bytes32(s), bytes32(0))
        ) {
            okPayments++;
            totalNative += amount;
        } catch {}
    }

    function payToken(uint256 s, uint256 r, uint128 amount, uint128 approval) external {
        address from = actors[s % actors.length];
        uint256 idx = r % ids.length;
        amount = uint128(bound(amount, 0, 1_000e18));
        approval = uint128(bound(approval, 0, 1_000e18));
        usdt.mint(from, amount);
        ghostMinted += amount;
        vm.startPrank(from);
        usdt.approve(address(pay), approval);
        try pay.payToken(
            IERC20(address(usdt)),
            amount,
            AtlasPay.Payment(ids[idx], actors[idx], AtlasPay.Kind.Tip, bytes32(r), bytes32(0))
        ) {
            okPayments++;
        } catch {}
        vm.stopPrank();
    }

    function sendDirect(uint96 amount) external {
        amount = uint96(bound(amount, 1, 1 ether));
        vm.deal(address(this), amount);
        (bool ok,) = address(pay).call{value: amount}("");
        ok; // must fail; checked by the invariant on balance
        usdt.mint(address(this), amount);
        ghostMinted += amount;
        // tokens pushed straight to the contract would be stuck; AtlasPay offers no way to move them, so the
        // handler never does it (real users can't be protected from that; ATLAS never asks for it)
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}

contract AtlasPayInvariants is StdInvariant, Test {
    MockAgentID internal agent;
    MockStable internal usdt;
    AtlasPay internal pay;
    PayHandler internal h;

    function setUp() public {
        agent = new MockAgentID();
        usdt = new MockStable();
        pay = new AtlasPay(IAgentID(address(agent)), IERC20(address(usdt)));
        address[] memory a = new address[](4);
        uint256[] memory ids = new uint256[](4);
        string[4] memory names = ["ann", "ben", "cat", "dan"];
        for (uint256 i; i < 4; i++) {
            a[i] = makeAddr(names[i]);
            ids[i] = uint256(keccak256(bytes(names[i])));
            if (i < 3) agent.registerFor(a[i], names[i]); // dan holds no Agent ID
        }
        h = new PayHandler(pay, usdt, a, ids);
        targetContract(address(h));
    }

    /// The contract never holds funds.
    function invariant_neverHoldsBNB() public view {
        assertEq(address(pay).balance, 0);
    }

    function invariant_neverHoldsTokens() public view {
        assertEq(usdt.balanceOf(address(pay)), 0);
    }

    /// Token supply is fully accounted for by actors and the handler: nothing leaks into AtlasPay.
    function invariant_tokensConserved() public view {
        uint256 sum = usdt.balanceOf(address(h));
        for (uint256 i; i < h.actorCount(); i++) {
            sum += usdt.balanceOf(h.actors(i));
        }
        assertEq(sum, usdt.totalSupply());
        assertEq(usdt.totalSupply(), h.ghostMinted());
    }
}
