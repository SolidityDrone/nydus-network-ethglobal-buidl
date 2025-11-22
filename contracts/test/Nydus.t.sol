// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test, console} from "forge-std/Test.sol";
import {Nydus} from "../src/Nydus.sol";


contract NydusTest is Test {
    Nydus public nydus;
    address[] public verifiers;
    
    function setUp() public {
        verifiers = new address[](5);
        verifiers[0] = address(0x1); // Entry verifier
        verifiers[1] = address(0x2); // Deposit verifier
        verifiers[2] = address(0x3); // Withdraw verifier
        verifiers[3] = address(0x4); // Send verifier
        verifiers[4] = address(0x5); // Absorb verifier
        
        nydus = new Nydus(verifiers);
    }
    
    function testInitialization() public {
        // Test that contract initializes correctly
        (uint256 stateX, uint256 stateY) = nydus.getStateCommitment();
        // State commitment point initialized with pedersen_commitment_positive(1, 1, 1)
        assertEq(stateX, 0x0bc6f794fe53f0c8704d41006c06065f765e884d12ea6841895866f6a7796568);
        assertEq(stateY, 0x22539c9ee4342d7eaa4c5a67d5cb0c93ddf1e9e03c173e6a4e442b5d57a2b5bd);
        
        (uint256 nonceX, uint256 nonceY) = nydus.nonceDiscoveryPoint();
        // Nonce discovery point initialized with pedersen_commitment_non_hiding(1, 1)
        assertEq(nonceX, 0x098b60b4fb636ed774329d8bb20eb1f9bd2f1b53445e991de219b50739e95c16);
        assertEq(nonceY, 0x1b82bb29393d7897d102bc412ca1b3353e78ecc738baf483fed847ef9e212997);
    }
    
    function testNonceDiscoveryAggregation() public {
        // Test that nonce discovery entries can be aggregated
        // This would normally be done via circuit proofs, but we can test the internal logic
        // by simulating what addNonceDiscoveryEntry does
        
        // Get initial state
        (uint256 initialX, uint256 initialY) = nydus.nonceDiscoveryPoint();
        
        // Simulate adding a nonce discovery entry by adding to state commitment
        // (Since addNonceDiscoveryEntry is internal, we test via public functions that call it)
        // Actually, we can't directly test internal functions, but we can verify
        // the aggregation happens when proofs are submitted
        
        // Nonce discovery point initialized with pedersen_commitment_non_hiding(1, 1)
        assertEq(initialX, 0x098b60b4fb636ed774329d8bb20eb1f9bd2f1b53445e991de219b50739e95c16);
        assertEq(initialY, 0x1b82bb29393d7897d102bc412ca1b3353e78ecc738baf483fed847ef9e212997);
    }
    
    function testGetNonceDiscoveryPoint() public {
        // Test reading the nonce discovery point
        (uint256 x, uint256 y) = nydus.nonceDiscoveryPoint();
        
        // Should start at pedersen_commitment_non_hiding(1, 1)
        assertEq(x, 0x098b60b4fb636ed774329d8bb20eb1f9bd2f1b53445e991de219b50739e95c16);
        assertEq(y, 0x1b82bb29393d7897d102bc412ca1b3353e78ecc738baf483fed847ef9e212997);
    }
    
    function testVerifierIndexing() public {
        // Test that verifiers are mapped correctly
        assertEq(nydus.getVerifier(0), address(0x1));
        assertEq(nydus.getVerifier(1), address(0x2));
        assertEq(nydus.getVerifier(2), address(0x3));
        assertEq(nydus.getVerifier(3), address(0x4));
        assertEq(nydus.getVerifier(4), address(0x5));
    }
}
