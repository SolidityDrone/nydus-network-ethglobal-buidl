/* // SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/Nydus.sol";

contract CommitmentTest is Test {
    Nydus public nydus;
    address[] public verifiers;
    
    function setUp() public {
        // Initialize with empty verifiers array for testing
        verifiers = new address[](1);
        verifiers[0] = address(0x123); // Dummy verifier address
        
        nydus = new Nydus(verifiers);
    }
    
    function testAddStateCommitment() public {
        // Test adding a commitment to state commitment point
        uint256 commitmentX = 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b;
        uint256 commitmentY = 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746;
        
        // Get initial state
        (uint256 initialX, uint256 initialY) = nydus.getStateCommitment();
        
        // Add commitment (m=0, r=0 for testing)
        (uint256 resultX, uint256 resultY) = nydus.addStateCommitment(commitmentX, commitmentY, 0, 0);
        
        // Verify the result is different from initial (due to Grumpkin addition)
        assertTrue(resultX != initialX || resultY != initialY);
        
        // Check current state
        (uint256 currentX, uint256 currentY) = nydus.getStateCommitment();
        assertEq(currentX, resultX);
        assertEq(currentY, resultY);
        
        // Check historical tracking
        assertTrue(nydus.isHistoricalStateCommitment(initialX, initialY));
        assertTrue(nydus.isHistoricalStateCommitment(resultX, resultY));
    }
    
    
    function testCommitmentAddition() public {
        // Test adding two commitments together using Grumpkin
        uint256 c1X = 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b;
        uint256 c1Y = 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746;
        uint256 c2X = 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd;
        uint256 c2Y = 0xb43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c;
        
        // Add them together
        (uint256 resultX, uint256 resultY) = nydus.addCommitments(c1X, c1Y, c2X, c2Y);
        
        // Verify the result
        assertTrue(resultX != 0);
        assertTrue(resultY != 0);
        
        // Verify the result is on the Grumpkin curve
        assertTrue(nydus.verifyGrumpkinCommitment(resultX, resultY));
    }
    
    function testStateCommitmentStacking() public {
        // Test adding multiple commitments to the state commitment point
        uint256 c1X = 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b;
        uint256 c1Y = 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746;
        
        // Get initial state
        (uint256 initialX, uint256 initialY) = nydus.getStateCommitment();
        
        // First commitment (m=0, r=0 for testing)
        (uint256 resultX1, uint256 resultY1) = nydus.addStateCommitment(c1X, c1Y, 0, 0);
        
        // Second commitment (should be added to the first)
        uint256 c2X = 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd;
        uint256 c2Y = 0xb43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c;
        
        (uint256 resultX2, uint256 resultY2) = nydus.addStateCommitment(c2X, c2Y, 0, 0);
        
        // The result should be different from both individual commitments
        assertTrue(resultX2 != c1X || resultY2 != c1Y);
        assertTrue(resultX2 != c2X || resultY2 != c2Y);
        
        // Check final state
        (uint256 finalX, uint256 finalY) = nydus.getStateCommitment();
        assertEq(finalX, resultX2);
        assertEq(finalY, resultY2);
    }
    
    function testMultipleStacks() public {
        // Test state commitment and user note commitments
        bytes memory user1PubKey = abi.encodePacked("user1_pubkey");
        bytes memory user2PubKey = abi.encodePacked("user2_pubkey");
        
        // Add commitments to state commitment point (m=0, r=0 for testing)
        uint256 c1X = 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b;
        uint256 c1Y = 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746;
        nydus.addStateCommitment(c1X, c1Y, 0, 0);
        
        uint256 c2X = 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd;
        uint256 c2Y = 0xb43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c;
        nydus.addStateCommitment(c2X, c2Y, 0, 0);
        
        // Add note commitments to user-specific stacks (m=0, r=0 for testing)
        uint256 n1X = 0x29ef727483c7cc3372c0cf6c28db5aeeb39631f06e3c347c26c9cbe21b2be93b;
        uint256 n1Y = 0x29ba904778f0f6ac407889a6ca86dfcef08f3755e977e43e0f7dd598244e7fff;
        nydus.addUserNoteCommitment(user1PubKey, n1X, n1Y, 0, 0);
        
        uint256 n2X = 0x1db7370efb5df1b07f31de2ccabdca80faab741b075d7e2c0d377c43e7402045;
        uint256 n2Y = 0xc9f323a3c9850632eb9d7f7883b390159d653ee98d6bcd0a44c50977940cf43;
        nydus.addUserNoteCommitment(user2PubKey, n2X, n2Y, 0, 0);
        
        // Verify state commitment
        (uint256 stateX, uint256 stateY) = nydus.getStateCommitment();
        assertTrue(stateX != 0);
        assertTrue(stateY != 0);
        
        // Verify user note commitments are independent
        (uint256 n1StoredX, uint256 n1StoredY, uint256 n1AggregatedM, uint256 n1AggregatedR, uint256 n1Count, bool n1Active) = nydus.getUserNoteCommitmentStack(user1PubKey);
        (uint256 n2StoredX, uint256 n2StoredY, uint256 n2AggregatedM, uint256 n2AggregatedR, uint256 n2Count, bool n2Active) = nydus.getUserNoteCommitmentStack(user2PubKey);
        
        assertTrue(n1StoredX != 0);
        assertTrue(n1StoredY != 0);
        assertTrue(n2StoredX != 0);
        assertTrue(n2StoredY != 0);
        
        assertTrue(n1Active);
        assertTrue(n2Active);
        
        // Verify they are different (due to 1-1-1 initializer + different commitments)
        assertTrue(n1StoredX != n2StoredX || n1StoredY != n2StoredY);
    }
    
    
    function testUserNoteCommitmentStack() public {
        // Test user-specific note commitment stack
        bytes memory userPubKey = abi.encodePacked("test_user_pubkey");
        
        // Initially empty stack should be initialized with 1-1-1
        (uint256 x, uint256 y, uint256 aggregatedM, uint256 aggregatedR, uint256 count, bool isActive) = nydus.getUserNoteCommitmentStack(userPubKey);
        assertEq(x, 0); // Not initialized yet
        assertEq(y, 0);
        assertEq(count, 0);
        assertFalse(isActive);
        
        // Add first commitment - should initialize with 1-1-1 and add the commitment (m=0, r=0 for testing)
        (uint256 resultX, uint256 resultY, uint256 resultCount) = nydus.addUserNoteCommitment(userPubKey, 5, 6, 0, 0);
        
        // Verify the result includes the 1-1-1 initializer
        assertTrue(resultX != 0);
        assertTrue(resultY != 0);
        assertEq(resultCount, 2); // 1 for initializer + 1 for new commitment
        
        // Verify stack data
        (x, y, aggregatedM, aggregatedR, count, isActive) = nydus.getUserNoteCommitmentStack(userPubKey);
        assertEq(x, resultX);
        assertEq(y, resultY);
        assertEq(count, 2);
        assertTrue(isActive);
        
        // Add second commitment (m=0, r=0 for testing)
        (resultX, resultY, resultCount) = nydus.addUserNoteCommitment(userPubKey, 7, 8, 0, 0);
        assertEq(resultCount, 3); // 1 for initializer + 2 commitments
        
        // Verify final stack data
        (x, y, aggregatedM, aggregatedR, count, isActive) = nydus.getUserNoteCommitmentStack(userPubKey);
        assertEq(x, resultX);
        assertEq(y, resultY);
        assertEq(count, 3);
        assertTrue(isActive);
    }
} */