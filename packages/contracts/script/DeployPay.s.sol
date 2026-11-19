// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAgentID} from "../src/interfaces/IAgentID.sol";
import {AtlasPay} from "../src/AtlasPay.sol";

/// Deploys ONLY AtlasPay (for when the ATLAS registries are already live, or Pay ships first).
/// Usage (mainnet): CONFIRM_MAINNET=yes forge script script/DeployPay.s.sol --rpc-url bsc --broadcast --verify
/// The deployer key is typed by the operator at deploy time (DEPLOYER_PRIVATE_KEY); never commit it.
/// AtlasPay has no owner: after deployment the deployer has no special power over it.
contract DeployPay is Script {
    address constant REAL_AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agentId = vm.envOr("AGENT_ID_ADDRESS", block.chainid == 56 ? REAL_AGENT_ID : address(0));
        address stable = vm.envOr("STABLE_TOKEN_ADDRESS", block.chainid == 56 ? BSC_USDT : address(0));
        checkConfig(block.chainid, vm.envOr("CONFIRM_MAINNET", string("")), agentId, stable);
        vm.startBroadcast(pk);
        AtlasPay pay = new AtlasPay(IAgentID(agentId), IERC20(stable));
        vm.stopBroadcast();
        string memory k = "pay";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", block.number);
        vm.serializeAddress(k, "agentId", agentId);
        vm.serializeAddress(k, "stableToken", stable);
        string memory json = vm.serializeAddress(k, "AtlasPay", address(pay));
        string memory file = string.concat("deployments/", vm.toString(block.chainid), ".pay.json");
        vm.writeJson(json, file);
        console2.log("AtlasPay", address(pay));
        console2.log("saved", file, "- set ATLAS_PAY_ADDRESS (and PAY_START_BLOCK) on the API host");
    }

    /// Mainnet guards, kept pure so they are unit-tested without touching process env.
    function checkConfig(uint256 chainId, string memory confirm, address agentId, address stable) public pure {
        if (chainId == 56) {
            require(keccak256(bytes(confirm)) == keccak256("yes"), "set CONFIRM_MAINNET=yes");
            require(agentId == REAL_AGENT_ID, "chain 56 requires the official Agent ID registry");
            require(stable == BSC_USDT, "chain 56 requires BSC USDT");
        }
        require(agentId != address(0) && stable != address(0), "set AGENT_ID_ADDRESS and STABLE_TOKEN_ADDRESS");
    }
}
