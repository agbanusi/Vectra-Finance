// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @title TestnetToken
/// @notice TESTNET ONLY. Faucet-mintable stand-in for a settlement asset (e.g. USDC) so anyone can try
///         Vectra on a public testnet. Has no value. Never deploy on a production network.
contract TestnetToken is ERC20 {
    /// @notice Per-call faucet cap (in whole tokens) to keep supply sane; the cap does not apply to
    ///         approved yield minters (testnet strategy vaults).
    uint256 public constant FAUCET_CAP = 100_000;

    uint8 private immutable _decimals;
    address public immutable owner;
    mapping(address => bool) public isMinter;

    error FaucetCapExceeded();
    error NotOwner();

    event MinterSet(address indexed minter, bool allowed);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
        owner = msg.sender;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Public faucet: mint up to FAUCET_CAP whole tokens per call.
    function mint(address to, uint256 amount) external {
        if (!isMinter[msg.sender] && msg.sender != owner && amount > FAUCET_CAP * 10 ** _decimals) {
            revert FaucetCapExceeded();
        }
        _mint(to, amount);
    }

    function setMinter(address minter, bool allowed) external {
        if (msg.sender != owner) revert NotOwner();
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }
}
