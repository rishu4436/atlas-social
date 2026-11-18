// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IAgentID} from "../src/interfaces/IAgentID.sol";
import {MockAgentID} from "../src/mocks/MockAgentID.sol";
import {AtlasIdentityRegistry} from "../src/AtlasIdentityRegistry.sol";
import {AtlasThesisRegistry} from "../src/AtlasThesisRegistry.sol";
import {AtlasReviewRegistry} from "../src/AtlasReviewRegistry.sol";
import {AtlasOutcomeRegistry} from "../src/AtlasOutcomeRegistry.sol";

/// Usage (testnet):  forge script script/Deploy.s.sol --rpc-url bsc_testnet --broadcast --verify
/// Usage (mainnet):  CONFIRM_MAINNET=yes forge script script/Deploy.s.sol --rpc-url bsc --broadcast --verify
/// Env: DEPLOYER_PRIVATE_KEY (never commit), optional AGENT_ID_ADDRESS, EVALUATOR_ADDRESS, OUTCOME_OWNER,
///      DISPUTE_WINDOW_SECONDS (default 172800).
contract Deploy is Script {
    address constant REAL_AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        if (block.chainid == 56) {
            require(keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) == keccak256("yes"), "set CONFIRM_MAINNET=yes");
        }
        address agentId = vm.envOr("AGENT_ID_ADDRESS", block.chainid == 56 ? REAL_AGENT_ID : address(0));
        uint64 window = uint64(vm.envOr("DISPUTE_WINDOW_SECONDS", uint256(2 days)));
        address outcomeOwner = vm.envOr("OUTCOME_OWNER", deployer);
        address evaluator = vm.envOr("EVALUATOR_ADDRESS", address(0));

        vm.startBroadcast(pk);
        bool mock = agentId == address(0);
        if (mock) agentId = address(new MockAgentID()); // TESTNET ONLY
        AtlasIdentityRegistry identity = new AtlasIdentityRegistry(IAgentID(agentId));
        AtlasThesisRegistry theses = new AtlasThesisRegistry(IAgentID(agentId));
        AtlasReviewRegistry reviews = new AtlasReviewRegistry(IAgentID(agentId), theses);
        AtlasOutcomeRegistry outcomes = new AtlasOutcomeRegistry(IAgentID(agentId), theses, window, outcomeOwner);
        if (evaluator != address(0) && outcomeOwner == deployer) outcomes.setEvaluator(evaluator, true);
        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", block.number);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeAddress(k, "agentId", agentId);
        vm.serializeBool(k, "agentIdIsMock", mock);
        vm.serializeAddress(k, "AtlasIdentityRegistry", address(identity));
        vm.serializeAddress(k, "AtlasThesisRegistry", address(theses));
        vm.serializeAddress(k, "AtlasReviewRegistry", address(reviews));
        vm.serializeUint(k, "disputeWindow", window);
        vm.serializeAddress(k, "outcomeOwner", outcomeOwner);
        string memory json = vm.serializeAddress(k, "AtlasOutcomeRegistry", address(outcomes));
        string memory file = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, file);
        console2.log("saved", file);
    }
}
