// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {Nydus} from "../src/Nydus.sol";
import {VerifiersConst} from "../src/VerifiersConst.sol";

/**
 * @title NydusDeploy
 * @notice Deploy Nydus contract using verifiers from VerifiersConst
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

        vm.startBroadcast();

        // Create verifiers array from VerifiersConst
        address[] memory verifiers = new address[](5);
        verifiers[0] = VerifiersConst.ENTRY_VERIFIER;
        verifiers[1] = VerifiersConst.DEPOSIT_VERIFIER;
        verifiers[2] = VerifiersConst.WITHDRAW_VERIFIER;
        verifiers[3] = VerifiersConst.SEND_VERIFIER;
        verifiers[4] = VerifiersConst.ABSORB_VERIFIER;
        
        // Deploy Nydus contract
        Nydus nydus = new Nydus(verifiers);
        address nydusAddress = address(nydus);
        
        console.log("Nydus deployed at:", nydusAddress);

        vm.stopBroadcast();

        console.log("Deployment completed successfully!");
        console.log("Nydus contract address:", nydusAddress);
    }
}
