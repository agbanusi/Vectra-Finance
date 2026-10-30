// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import {IComplianceModule} from "../interfaces/IComplianceModule.sol";

/// @notice External, off-chain eligibility attestation boundary.
/// @dev Implementations must return only a boolean derived from a provider's own verification
///      process. No identity documents or personal data are stored on-chain by this protocol.
interface IEligibilityProvider {
    function isEligible(address account, bytes32 policyId) external view returns (bool);
}

/// @title AllowlistCompliance
/// @notice Eligibility policy for restricted indexes (e.g. RWA-backed products).
/// @dev Eligibility can come from a locally managed attestor allowlist and/or an external provider.
///      Revocation is immediate for future actions; already escrowed redemption shares can only be
///      returned to an eligible recipient (see vault `cancelRedemption`).
contract AllowlistCompliance is IComplianceModule, AccessControl {
    bytes32 public constant ATTESTOR_ROLE = keccak256("VECTRA_ATTESTOR_ROLE");

    error NotEligible(address account);
    error InvalidExpiry();

    struct Attestation {
        bool eligible;
        uint64 expiresAt; // 0 = no expiry
    }

    bytes32 public immutable policyId;
    IEligibilityProvider public provider;

    mapping(address => Attestation) private _attestations;

    event EligibilitySet(address indexed account, bool eligible, uint64 expiresAt, address indexed attestor);
    event ProviderSet(address indexed provider);

    constructor(bytes32 policyId_, address admin_, address provider_) {
        policyId = policyId_;
        provider = IEligibilityProvider(provider_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ATTESTOR_ROLE, admin_);
    }

    /// @notice Record only the minimum eligibility bit plus optional expiry. Never store PII on-chain.
    function setEligibility(address account, bool eligible, uint64 expiresAt) external onlyRole(ATTESTOR_ROLE) {
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();
        _attestations[account] = Attestation({eligible: eligible, expiresAt: expiresAt});
        emit EligibilitySet(account, eligible, expiresAt, msg.sender);
    }

    function setProvider(address provider_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        provider = IEligibilityProvider(provider_);
        emit ProviderSet(provider_);
    }

    function isEligible(address account) public view returns (bool) {
        if (account == address(0)) return false;
        Attestation memory a = _attestations[account];
        if (a.eligible && (a.expiresAt == 0 || a.expiresAt > block.timestamp)) return true;
        IEligibilityProvider p = provider;
        if (address(p) == address(0)) return false;
        // Provider failures fail closed: a reverting provider makes the account ineligible.
        try p.isEligible(account, policyId) returns (bool result) {
            return result;
        } catch {
            return false;
        }
    }

    function validateDeposit(address account, address receiver, uint256) external view override {
        if (!isEligible(account)) revert NotEligible(account);
        if (receiver != account && !isEligible(receiver)) revert NotEligible(receiver);
    }

    function validateRedeem(address account, address receiver, uint256) external view override {
        if (!isEligible(account)) revert NotEligible(account);
        if (receiver != account && !isEligible(receiver)) revert NotEligible(receiver);
    }

    function validateTransfer(address from, address to, uint256) external view override {
        // Receiving is restricted. Sending from a revoked holder is permitted so positions can
        // always be transferred to an eligible recipient (they cannot transfer to ineligible ones).
        if (!isEligible(to)) revert NotEligible(to);
        if (from == address(0)) revert NotEligible(from);
    }

    function policy() external pure override returns (string memory) {
        return "allowlist";
    }
}
