// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockStable — LOCAL / TEST ONLY stand-in for BSC USDT (18 decimals, like BSC-USD). Anyone can mint.
contract MockStable is ERC20 {
    constructor() ERC20("MOCK USDT (test only)", "mUSDT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice TEST ONLY: takes a 1% fee on transfer (AtlasPay must reject it: recipient would get less than approved).
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("FEE", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xFEE), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
