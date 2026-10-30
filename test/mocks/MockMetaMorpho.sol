// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {MockERC4626} from "./MockERC4626.sol";

/// @notice MetaMorpho v1.1-style vault: ERC-4626 plus the `lostAssets()` bad-debt counter.
contract MockMetaMorpho is MockERC4626 {
    uint256 public lostAssets;

    constructor(IERC20 asset_) MockERC4626(asset_, "MetaMorpho Mock", "mmMOCK") {}

    function setLostAssets(uint256 value) external {
        lostAssets = value;
    }
}
