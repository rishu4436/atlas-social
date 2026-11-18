// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockAgentID — TEST / TESTNET ONLY
/// @notice Mirrors the read surface of the SPACE ID Agent ID registry (balanceOf, ownerOf, handleOf), which only
///         exists on BSC mainnet. Anyone can self-register one non-transferable handle. NOT an identity source.
contract MockAgentID {
    string public constant name = "MOCK Agent ID (testnet only)";
    string public constant symbol = "MOCKAI";

    mapping(address => string) private _handleOf;
    mapping(uint256 => address) private _ownerOf;

    event Registered(uint256 indexed tokenId, address indexed owner, string handle);
    event Revoked(uint256 indexed tokenId, address indexed owner);

    error AlreadyHasAgentId();
    error HandleTaken();
    error InvalidHandle();
    error NonexistentToken(uint256 tokenId);

    function register(string calldata handle) external {
        _register(msg.sender, handle);
    }

    function registerFor(address owner, string calldata handle) external {
        _register(owner, handle);
    }

    function revoke() external {
        string memory h = _handleOf[msg.sender];
        if (bytes(h).length == 0) revert InvalidHandle();
        uint256 id = uint256(keccak256(bytes(h)));
        delete _ownerOf[id];
        delete _handleOf[msg.sender];
        emit Revoked(id, msg.sender);
    }

    function balanceOf(address owner) external view returns (uint256) {
        return bytes(_handleOf[owner]).length == 0 ? 0 : 1;
    }

    function handleOf(address owner) external view returns (string memory) {
        return _handleOf[owner];
    }

    function ownerOf(uint256 tokenId) external view returns (address o) {
        o = _ownerOf[tokenId];
        if (o == address(0)) revert NonexistentToken(tokenId);
    }

    function _register(address owner, string calldata handle) internal {
        bytes memory b = bytes(handle);
        if (b.length < 1 || b.length > 20) revert InvalidHandle();
        if (bytes(_handleOf[owner]).length != 0) revert AlreadyHasAgentId();
        uint256 id = uint256(keccak256(b));
        if (_ownerOf[id] != address(0)) revert HandleTaken();
        _ownerOf[id] = owner;
        _handleOf[owner] = handle;
        emit Registered(id, owner, handle);
    }
}

/// @notice TEST ONLY: a broken registry whose balanceOf/handleOf disagree with ownerOf (spoofing scenario).
contract SpoofAgentID {
    address public realOwner;

    constructor(address realOwner_) {
        realOwner = realOwner_;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 1;
    }

    function handleOf(address) external pure returns (string memory) {
        return "victim";
    }

    function ownerOf(uint256) external view returns (address) {
        return realOwner;
    }
}
