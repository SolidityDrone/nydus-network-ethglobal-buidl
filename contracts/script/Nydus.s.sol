// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {Nydus} from "../src/Nydus.sol";
import {VerifiersConst} from "../src/VerifiersConst.sol";
import {CountryCodes} from "@selfxyz/contracts/contracts/libraries/CountryCode.sol";
import {SelfUtils} from "@selfxyz/contracts/contracts/libraries/SelfUtils.sol";

/**
 * @title NydusDeploy
 * @notice Deploy Nydus contract using verifiers from VerifiersConst and Self Protocol parameters
 * @dev Requires the following environment variables:
 *      - IDENTITY_VERIFICATION_HUB_ADDRESS: Address of the Self Protocol verification hub
 *      - SCOPE_SEED: Scope seed value (defaults to "self-workshop")
 */
contract NydusDeployer is Script {
  
    function setUp() public {}

    function run() public {
        console.log("Deploying Nydus contract...");
        console.log("Using verifiers from VerifiersConst:");
        console.log("  ENTRY_VERIFIER:", VerifiersConst.ENTRY_VERIFIER);
        console.log("  DEPOSIT_VERIFIER:", VerifiersConst.DEPOSIT_VERIFIER);
        console.log("  WITHDRAW_VERIFIER:", VerifiersConst.WITHDRAW_VERIFIER);
        console.log("  SEND_VERIFIER:", VerifiersConst.SEND_VERIFIER);
        console.log("  ABSORB_VERIFIER:", VerifiersConst.ABSORB_VERIFIER);

        // Get Self Protocol parameters from environment variables
        address hubAddress = 0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74;
        string memory scopeSeed = "self-workshop";
        
        console.log("Self Protocol parameters:");
        console.log("  Identity Verification Hub:", hubAddress);
        console.log("  Scope Seed:", scopeSeed);
        
        // Create verification config (must match frontend and ProofOfHuman deployment)
        string[] memory forbiddenCountries = new string[](1);
        forbiddenCountries[0] = CountryCodes.UNITED_STATES;
        SelfUtils.UnformattedVerificationConfigV2 memory verificationConfig = SelfUtils.UnformattedVerificationConfigV2({
            olderThan: 18,
            forbiddenCountries: forbiddenCountries,
            ofacEnabled: true  // OFAC compliance check enabled
        });

        vm.startBroadcast();

        // Create verifiers array from VerifiersConst
        address[] memory verifiers = new address[](5);
        verifiers[0] = VerifiersConst.ENTRY_VERIFIER;
        verifiers[1] = VerifiersConst.DEPOSIT_VERIFIER;
        verifiers[2] = VerifiersConst.WITHDRAW_VERIFIER;
        verifiers[3] = VerifiersConst.SEND_VERIFIER;
        verifiers[4] = VerifiersConst.ABSORB_VERIFIER;
        
        // Deploy Nydus contract with all required parameters
        Nydus nydus = new Nydus(
            verifiers,
            hubAddress,
            scopeSeed,
            verificationConfig
        );
        address nydusAddress = address(nydus);
        
        console.log("Nydus deployed at:", nydusAddress);

        vm.stopBroadcast();

        console.log("Deployment completed successfully!");
        console.log("Nydus contract address:", nydusAddress);
    }
}
