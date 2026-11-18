// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal read interface of the SPACE ID "Agent ID" registry used by Binance Agentic Wallet.
/// @dev BSC mainnet: 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F (ERC-721, symbol "AI", non-transferable).
///      `balanceOf` is the official holder check from the hackathon announcement.
///      `handleOf` was confirmed against the deployed bytecode and live calls (returns "" for non-holders).
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
    function handleOf(address owner) external view returns (string memory);
}
