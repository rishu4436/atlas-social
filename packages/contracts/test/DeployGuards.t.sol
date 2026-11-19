// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployPay} from "../script/DeployPay.s.sol";

/// Mainnet guards of the AtlasPay deploy script.
contract DeployGuardsTest is Test {
    DeployPay internal s = new DeployPay();
    address constant REG = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;

    function test_mainnetRequiresExplicitConfirm() public {
        vm.expectRevert(bytes("set CONFIRM_MAINNET=yes"));
        s.checkConfig(56, "", REG, USDT);
    }

    function test_mainnetRejectsNonOfficialRegistry() public {
        vm.expectRevert(bytes("chain 56 requires the official Agent ID registry"));
        s.checkConfig(56, "yes", address(0xBEEF), USDT);
    }

    function test_mainnetRejectsNonUsdtStable() public {
        vm.expectRevert(bytes("chain 56 requires BSC USDT"));
        s.checkConfig(56, "yes", REG, address(0xCAFE));
    }

    function test_mainnetAcceptsOfficialConfig() public view {
        s.checkConfig(56, "yes", REG, USDT);
    }

    function test_localNeedsAddresses() public {
        vm.expectRevert(bytes("set AGENT_ID_ADDRESS and STABLE_TOKEN_ADDRESS"));
        s.checkConfig(31337, "", address(0), address(0));
    }
}
