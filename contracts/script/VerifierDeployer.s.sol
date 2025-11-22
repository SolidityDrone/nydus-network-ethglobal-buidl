// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Script, console} from "forge-std/Script.sol";
import {HonkVerifier as EntryVerifier} from "../src/Verifiers/VerifierEntry.sol";
import {HonkVerifier as SendVerifier} from "../src/Verifiers/VerifierSend.sol";
import {HonkVerifier as AbsorbVerifier} from "../src/Verifiers/VerifierAbsorb.sol";
import {HonkVerifier as DepositVerifier} from "../src/Verifiers/VerifierDeposit.sol";
import {HonkVerifier as WithdrawVerifier} from "../src/Verifiers/VerifierWithdraw.sol";

/**
 * @title VerifierDeployer
 * @notice Deploy all 5 verifiers at once
 */


contract VerifierDeployer is Script {
   
    function setUp() public {}
    
    
    function run() public {
        console.log("Deploying all 5 verifiers...");
        
        vm.startBroadcast();
        
        // Deploy Entry Verifier
        console.log("Deploying Entry Verifier...");
        EntryVerifier entryVerifier = new EntryVerifier();
        address entryAddress = address(entryVerifier);
        console.log("Entry Verifier deployed at:", entryAddress);
        
        // Deploy Send Verifier
        console.log("Deploying Send Verifier...");
        SendVerifier sendVerifier = new SendVerifier();
        address sendAddress = address(sendVerifier);
        console.log("Send Verifier deployed at:", sendAddress);
        
        // Deploy Absorb Verifier
        console.log("Deploying Absorb Verifier...");
        AbsorbVerifier absorbVerifier = new AbsorbVerifier();
        address absorbAddress = address(absorbVerifier);
        console.log("Absorb Verifier deployed at:", absorbAddress);
        
        // Deploy Deposit Verifier
        console.log("Deploying Deposit Verifier...");
        DepositVerifier depositVerifier = new DepositVerifier();
        address depositAddress = address(depositVerifier);
        console.log("Deposit Verifier deployed at:", depositAddress);
        
        // Deploy Withdraw Verifier
        console.log("Deploying Withdraw Verifier...");
        WithdrawVerifier withdrawVerifier = new WithdrawVerifier();
        address withdrawAddress = address(withdrawVerifier);
        console.log("Withdraw Verifier deployed at:", withdrawAddress);
        
        vm.stopBroadcast();
        

        
        // Write addresses to VerifiersConst.sol
        address[5] memory addresses = [entryAddress, sendAddress, absorbAddress, depositAddress, withdrawAddress];
        writeVerifiersConst(addresses);
    }
    
    function writeVerifiersConst(address[5] memory addresses) internal {
        // Build content step by step to avoid stack too deep
        string memory header = "// SPDX-License-Identifier: UNLICENSED\npragma solidity ^0.8.13;\n\nlibrary VerifiersConst {\n";
        
        string memory entry = string(abi.encodePacked("    address public constant ENTRY_VERIFIER = ", vm.toString(addresses[0]), ";\n"));
        string memory send = string(abi.encodePacked("    address public constant SEND_VERIFIER = ", vm.toString(addresses[1]), ";\n"));
        string memory absorb = string(abi.encodePacked("    address public constant ABSORB_VERIFIER = ", vm.toString(addresses[2]), ";\n"));
        string memory deposit = string(abi.encodePacked("    address public constant DEPOSIT_VERIFIER = ", vm.toString(addresses[3]), ";\n"));
        string memory withdraw = string(abi.encodePacked("    address public constant WITHDRAW_VERIFIER = ", vm.toString(addresses[4]), ";\n"));
        
        string memory footer = "}\n";
        
        // Combine in two steps to avoid stack too deep
        string memory part1 = string(abi.encodePacked(header, entry, send));
        string memory part2 = string(abi.encodePacked(absorb, deposit, withdraw, footer));
        
        string memory content = string(abi.encodePacked(part1, part2));
        
        vm.writeFile("src/VerifiersConst.sol", content);
    }
    
}
 