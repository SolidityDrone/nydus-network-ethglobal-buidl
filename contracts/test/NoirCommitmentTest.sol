// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/Nydus.sol";

contract NoirCommitmentTest is Test {
    Nydus public nydus;
    address[] public verifiers;
    
    function setUp() public {
        // Initialize with empty verifiers array for testing
        verifiers = new address[](1);
        verifiers[0] = address(0x123); // Dummy verifier address
        
        nydus = new Nydus(verifiers);
    }
    
    function testNoirCommitmentAddition() public {
        // Test adding two commitments using Grumpkin curve
        // These are valid Grumpkin curve points from the GrumpkinTest.sol
        
        // Valid Grumpkin curve points
        uint256 c1X = 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b;
        uint256 c1Y = 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746;
        
        uint256 c2X = 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd;
        uint256 c2Y = 0xb43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c;
        
        // Test Grumpkin curve operations
        console.log("=== TESTING GRUMPKIN CURVE OPERATIONS ===");
        console.log("C1.x =", c1X);
        console.log("C1.y =", c1Y);
        console.log("C2.x =", c2X);
        console.log("C2.y =", c2Y);
        
        // Test curve validation
        bool c1Valid = nydus.verifyGrumpkinCommitment(c1X, c1Y);
        bool c2Valid = nydus.verifyGrumpkinCommitment(c2X, c2Y);
        
        console.log("C1 is valid on Grumpkin:", c1Valid);
        console.log("C2 is valid on Grumpkin:", c2Valid);
        
        assertTrue(c1Valid, "C1 should be valid on Grumpkin curve");
        assertTrue(c2Valid, "C2 should be valid on Grumpkin curve");
        
        // Test addition operation
        console.log("=== TESTING GRUMPKIN COMMITMENT ADDITION ===");
        
        (uint256 resultX, uint256 resultY) = nydus.addCommitments(c1X, c1Y, c2X, c2Y);
        console.log("Addition successful:");
        console.log("Result.x =", resultX);
        console.log("Result.y =", resultY);
        
        // Verify the result is valid
        bool resultValid = nydus.verifyGrumpkinCommitment(resultX, resultY);
        assertTrue(resultValid, "Result should be valid on Grumpkin curve");
        
        // Store the result in state commitment point (m=0, r=0 for testing)
        (uint256 storedX, uint256 storedY) = nydus.addStateCommitment(resultX, resultY, 0, 0);
        
        // Verify the state commitment was updated
        (uint256 currentStateX, uint256 currentStateY) = nydus.getStateCommitment();
        assertEq(currentStateX, storedX);
        assertEq(currentStateY, storedY);
        
        // Store the individual commitments in user note commitment stacks (m=0, r=0 for testing)
        bytes memory user1PubKey = abi.encodePacked("noir_user1");
        bytes memory user2PubKey = abi.encodePacked("noir_user2");
        
        nydus.addUserNoteCommitment(user1PubKey, c1X, c1Y, 0, 0);
        nydus.addUserNoteCommitment(user2PubKey, c2X, c2Y, 0, 0);
        
        // Verify user note stacks have commitments
        (uint256 note1X, uint256 note1Y, uint256 note1AggregatedM, uint256 note1AggregatedR, uint256 note1Count, bool note1Active) = nydus.getUserNoteCommitmentStack(user1PubKey);
        (uint256 note2X, uint256 note2Y, uint256 note2AggregatedM, uint256 note2AggregatedR, uint256 note2Count, bool note2Active) = nydus.getUserNoteCommitmentStack(user2PubKey);
        
        assertTrue(note1Active);
        assertTrue(note2Active);
        assertEq(note1Count, 2); // 1 for initializer + 1 for commitment
        assertEq(note2Count, 2); // 1 for initializer + 1 for commitment
        
        console.log("Grumpkin commitment addition and storage successful!");
        console.log("State commitment x:", storedX);
        console.log("State commitment y:", storedY);
        console.log("User 1 note count:", note1Count);
        console.log("User 2 note count:", note2Count);
    }
    
}