// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { SelfVerificationRoot } from "@selfxyz/contracts/contracts/abstract/SelfVerificationRoot.sol";
import { ISelfVerificationRoot } from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";
import { SelfStructs } from "@selfxyz/contracts/contracts/libraries/SelfStructs.sol";
import { SelfUtils } from "@selfxyz/contracts/contracts/libraries/SelfUtils.sol";
import { IIdentityVerificationHubV2 } from "@selfxyz/contracts/contracts/interfaces/IIdentityVerificationHubV2.sol";

/**
 * @title ProofOfHuman
 * @notice Demo implementation of SelfVerificationRoot for Proof of Human verification
 * @dev This contract provides a simple working implementation of the abstract SelfVerificationRoot
 */
contract ProofOfHuman is SelfVerificationRoot {
    // Verification result storage
    ISelfVerificationRoot.GenericDiscloseOutputV2 public lastOutput;
    bool public verificationSuccessful;
    bytes public lastUserData;
    address public lastUserAddress;

    // Verification config storage
    SelfStructs.VerificationConfigV2 public verificationConfig;
    bytes32 public verificationConfigId;
    
    // Store OFAC enabled status separately for easy access
    bool public ofacEnabled;

  
    mapping(address => bytes32) public usedUserAddressToProofNonOfac;
    // Events for testing
    event VerificationCompleted(ISelfVerificationRoot.GenericDiscloseOutputV2 output, bytes userData);
    event UserVerified(bytes32 indexed userIdentifierHash, address indexed userAddress);

    /**
     * @notice Constructor for the test contract
     * @param identityVerificationHubV2Address The address of the Identity Verification Hub V2
     * @param scopeSeed The scope seed that is used to create the scope of the contract
     * @param _verificationConfig The verification configuration that will be used to process the proof in the VerificationHub
     */
    constructor(
        address identityVerificationHubV2Address,
        string memory scopeSeed, 
        SelfUtils.UnformattedVerificationConfigV2 memory _verificationConfig
    )
        SelfVerificationRoot(identityVerificationHubV2Address, scopeSeed)
    {
        verificationConfig = SelfUtils.formatVerificationConfigV2(_verificationConfig);
        verificationConfigId =
        IIdentityVerificationHubV2(identityVerificationHubV2Address).setVerificationConfigV2(verificationConfig);
        
        // Store OFAC enabled status from the unformatted config
        ofacEnabled = _verificationConfig.ofacEnabled;
    }

    /**
     * @notice Implementation of customVerificationHook from SelfVerificationRoot
     * @dev This function is called by onVerificationSuccess after hub address validation
     * @param output The verification output from the hub
     * @param userData The user data passed through verification
     */

    function customVerificationHook(
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes memory userData
    )
        internal
        override
    {
        // Hash the userIdentifier and save it in the mapping
        bytes32 userIdentifierHash = keccak256(abi.encodePacked(output.userIdentifier));
        address userAddress = address(uint160(output.userIdentifier));
        usedUserAddressToProofNonOfac[userAddress] = userIdentifierHash;

        verificationSuccessful = true;
        
        lastUserAddress = address(uint160(output.userIdentifier));

        emit VerificationCompleted(output, userData);
        emit UserVerified(userIdentifierHash, lastUserAddress);
    }

    /**
     * @notice Implementation of getConfigId from SelfVerificationRoot
     * @dev Returns the verification config ID for this contract.
     *      - destinationChainId: The destination chain ID (placeholder for future crosschain use)
     *      - userIdentifier: The user identifier (passed in from the frontends userId field)
     *      - userDefinedData: The user defined data (passed in from the frontends userDefinedData field)
     * @return The verification configuration ID
     */
    function getConfigId(
        bytes32, /* destinationChainId */
        bytes32, /* userIdentifier */
        bytes memory /* userDefinedData */
    )
        public
        view
        override
        returns (bytes32)
    {
        return verificationConfigId;
    }
}
