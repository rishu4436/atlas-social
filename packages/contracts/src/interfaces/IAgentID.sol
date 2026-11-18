// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read interface of the official SPACE ID "Agent ID" registry used by Binance Agentic Wallet.
/// @dev BSC mainnet: 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F (ERC-721 "SPACE ID Agent ID", symbol "AI",
///      non-transferable). `balanceOf` is the eligibility check documented in the hackathon rules.
///      `handleOf(address)` and `ownerOf(uint256)` were confirmed against the deployed bytecode and live
///      calls on 2026-11-18: tokenId == uint256(keccak256(bytes(handle))) (e.g. "panqpunq").
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function handleOf(address owner) external view returns (string memory);
}
