// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {AgentIdGated} from "../src/AgentIdGated.sol";
import {AtlasIdentityRegistry} from "../src/AtlasIdentityRegistry.sol";
import {SpoofAgentID} from "../src/mocks/MockAgentID.sol";
import {IAgentID} from "../src/interfaces/IAgentID.sol";

contract AtlasIdentityRegistryTest is Base {
    event IdentityRegistered(
        address indexed wallet, uint256 indexed agentTokenId, bytes32 indexed commitment, string handle, uint32 proofCount, bool firstRegistration
    );

    function test_registerIdentity_emitsAndRecords() public {
        bytes32 c = keccak256("login-1");
        vm.expectEmit(address(identity));
        emit IdentityRegistered(alice, uint256(keccak256("alice")), c, "alice", 1, true);
        vm.prank(alice);
        identity.registerIdentity(c);
        assertEq(identity.commitmentUsedBy(c), alice);
        assertEq(identity.registeredCount(), 1);
        (bool eligible, bool registered, uint256 tokenId, string memory handle) = identity.verifyIdentity(alice);
        assertTrue(eligible);
        assertTrue(registered);
        assertEq(tokenId, uint256(keccak256("alice")));
        assertEq(handle, "alice");
    }

    function test_returningProof_incrementsWithoutRecounting() public {
        vm.startPrank(alice);
        identity.registerIdentity(keccak256("a"));
        identity.registerIdentity(keccak256("b"));
        vm.stopPrank();
        assertEq(identity.identityOf(alice).proofCount, 2);
        assertEq(identity.registeredCount(), 1);
    }

    function test_revert_nonHolder() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.NotAgentIdHolder.selector, outsider));
        identity.registerIdentity(keccak256("x"));
    }

    function test_revert_commitmentReplay() public {
        bytes32 c = keccak256("once");
        vm.prank(alice);
        identity.registerIdentity(c);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AtlasIdentityRegistry.CommitmentAlreadyUsed.selector, c));
        identity.registerIdentity(c);
    }

    function test_revert_emptyCommitment() public {
        vm.prank(alice);
        vm.expectRevert(AtlasIdentityRegistry.EmptyCommitment.selector);
        identity.registerIdentity(bytes32(0));
    }

    function test_revokedAgentId_losesEligibility() public {
        vm.prank(alice);
        identity.registerIdentity(keccak256("a"));
        vm.prank(alice);
        agent.revoke();
        (bool eligible, bool registered,,) = identity.verifyIdentity(alice);
        assertFalse(eligible);
        assertFalse(registered);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.NotAgentIdHolder.selector, alice));
        identity.registerIdentity(keccak256("b"));
    }

    function test_spoofedRegistry_tokenOwnershipMismatchRejected() public {
        SpoofAgentID spoof = new SpoofAgentID(bob);
        AtlasIdentityRegistry r = new AtlasIdentityRegistry(IAgentID(address(spoof)));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.AgentTokenMismatch.selector, alice));
        r.registerIdentity(keccak256("x"));
        (bool eligible,,,) = r.verifyIdentity(alice);
        assertFalse(eligible);
    }

    function test_verifyIdentity_unregisteredHolder() public view {
        (bool eligible, bool registered,,) = identity.verifyIdentity(bob);
        assertTrue(eligible);
        assertFalse(registered);
        (eligible,,,) = identity.verifyIdentity(outsider);
        assertFalse(eligible);
    }

    function test_revert_zeroRegistry() public {
        vm.expectRevert(AgentIdGated.ZeroAddress.selector);
        new AtlasIdentityRegistry(IAgentID(address(0)));
    }

    function testFuzz_commitmentsSingleUse(bytes32 c, uint8 who) public {
        vm.assume(c != bytes32(0));
        address first = who % 2 == 0 ? alice : bob;
        address second = who % 2 == 0 ? bob : alice;
        vm.prank(first);
        identity.registerIdentity(c);
        vm.prank(second);
        vm.expectRevert(abi.encodeWithSelector(AtlasIdentityRegistry.CommitmentAlreadyUsed.selector, c));
        identity.registerIdentity(c);
        assertEq(identity.commitmentUsedBy(c), first);
    }

    function testFuzz_nonHoldersAlwaysRejected(address caller, bytes32 c) public {
        vm.assume(caller != alice && caller != bob && caller != carol);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(AgentIdGated.NotAgentIdHolder.selector, caller));
        identity.registerIdentity(c);
    }
}
