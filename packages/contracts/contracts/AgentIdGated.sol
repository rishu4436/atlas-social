// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentID} from "./interfaces/IAgentID.sol";

/// @title AgentIdGated
/// @notice Shared modifier: the *caller itself* must hold a Binance Agent ID (name.ai).
///         Holding is checked live on every call, so a revoked/burned Agent ID loses access immediately.
abstract contract AgentIdGated {
    IAgentID public immutable agentId;

    error NotAgentIdHolder(address caller);
    error ZeroAddress();

    constructor(IAgentID agentId_) {
        if (address(agentId_) == address(0)) revert ZeroAddress();
        agentId = agentId_;
    }

    modifier onlyAgentId() {
        if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder(msg.sender);
        _;
    }

    function _handleOf(address account) internal view returns (string memory) {
        return agentId.handleOf(account);
    }
}
