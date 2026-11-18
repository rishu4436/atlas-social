// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockAgentID — TEST / TESTNET ONLY
/// @notice Stand-in for the SPACE ID Agent ID registry (which only exists on BSC mainnet).
///         Anyone can self-register one non-transferable handle. NEVER deploy as a real identity source.
contract MockAgentID {
    string public constant name = "MOCK Agent ID (testnet only)";
    string public constant symbol = "MOCKAI";

    mapping(address => string) private _handleOf;
    mapping(bytes32 => address) private _ownerOfHandle;

    event Registered(uint256 indexed tokenId, address indexed owner, string handle);
    event Revoked(uint256 indexed tokenId, address indexed owner);

    error AlreadyHasAgentId();
    error HandleTaken();
    error InvalidHandle();

    function register(string calldata handle) external {
        _register(msg.sender, handle);
    }

    /// @dev Test helper to register for another address (only meaningful in tests / testnet demos).
    function registerFor(address owner, string calldata handle) external {
        _register(owner, handle);
    }

    function revoke() external {
        string memory h = _handleOf[msg.sender];
        if (bytes(h).length == 0) revert InvalidHandle();
        bytes32 id = keccak256(bytes(h));
        delete _ownerOfHandle[id];
        delete _handleOf[msg.sender];
        emit Revoked(uint256(id), msg.sender);
    }

    function balanceOf(address owner) external view returns (uint256) {
        return bytes(_handleOf[owner]).length == 0 ? 0 : 1;
    }

    function handleOf(address owner) external view returns (string memory) {
        return _handleOf[owner];
    }

    function ownerOfHandle(string calldata handle) external view returns (address) {
        return _ownerOfHandle[keccak256(bytes(handle))];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return _ownerOfHandle[bytes32(tokenId)];
    }

    function _register(address owner, string calldata handle) internal {
        bytes memory b = bytes(handle);
        if (b.length < 1 || b.length > 20) revert InvalidHandle();
        if (bytes(_handleOf[owner]).length != 0) revert AlreadyHasAgentId();
        bytes32 id = keccak256(b);
        if (_ownerOfHandle[id] != address(0)) revert HandleTaken();
        _ownerOfHandle[id] = owner;
        _handleOf[owner] = handle;
        emit Registered(uint256(id), owner, handle);
    }
}
