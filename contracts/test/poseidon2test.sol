// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../lib/poseidon2-evm/src/Poseidon2.sol";
import "../lib/poseidon2-evm/src/Field.sol";

contract Poseidon2Test is Test {
    Poseidon2 public poseidon2;

    function setUp() public {
        poseidon2 = new Poseidon2();
    }

    function testHashValue1234() public {
        // Test hashing the value 1234
        uint256 input = 1234;
        Field.Type fieldInput = Field.toField(input);
        Field.Type fieldResult = poseidon2.hash_1(fieldInput);
        uint256 result = Field.toUint256(fieldResult);
        
        console.log("Input value: %s", input);
        console.log("Poseidon2 hash result: %s", result);
        console.log("Poseidon2 hash result (hex): 0x%x", result);
        
        // Verify the result is not zero (basic sanity check)
        assertTrue(result != 0, "Hash result should not be zero");
        
        // The exact expected value would need to be calculated separately
        // For now, we just verify it produces a valid hash
        assertTrue(result > 0, "Hash result should be positive");
    }

    function testHashTwoValues() public {
        // Test hashing two values: 1234 and 456
        uint256 x = 1234;
        uint256 y = 456;
        Field.Type fieldX = Field.toField(x);
        Field.Type fieldY = Field.toField(y);
        Field.Type fieldResult = poseidon2.hash_2(fieldX, fieldY);
        uint256 result = Field.toUint256(fieldResult);
        
        console.log("Input values: %s, %s", x, y);
        console.log("Poseidon2 hash_2 result: %s", result);
        console.log("Poseidon2 hash_2 result (hex): 0x%x", result);
        
        assertTrue(result != 0, "Hash result should not be zero");
    }

    function testHashThreeValues() public {
        // Test hashing three values: 1234, 456, 789
        uint256 x = 1234;
        uint256 y = 456;
        uint256 z = 789;
        Field.Type fieldX = Field.toField(x);
        Field.Type fieldY = Field.toField(y);
        Field.Type fieldZ = Field.toField(z);
        Field.Type fieldResult = poseidon2.hash_3(fieldX, fieldY, fieldZ);
        uint256 result = Field.toUint256(fieldResult);
        
        console.log("Input values: %s, %s, %s", x, y, z);
        console.log("Poseidon2 hash_3 result: %s", result);
        console.log("Poseidon2 hash_3 result (hex): 0x%x", result);
        
        assertTrue(result != 0, "Hash result should not be zero");
    }

    function testHashArray() public {
        // Test hashing an array with value 1234
        uint256[] memory input = new uint256[](1);
        input[0] = 1234;
        
        // Convert uint256 array to Field.Type array
        Field.Type[] memory fieldInput = new Field.Type[](1);
        fieldInput[0] = Field.toField(input[0]);
        
        Field.Type fieldResult = poseidon2.hash(fieldInput);
        uint256 result = Field.toUint256(fieldResult);
        
        console.log("Array input: [%s]", input[0]);
        console.log("Poseidon2 hash array result: %s", result);
        console.log("Poseidon2 hash array result (hex): 0x%x", result);
        
        assertTrue(result != 0, "Hash result should not be zero");
    }

    function testHash0x1234() public {
        // Test hashing 0x12344 (4660 in decimal) to compare with Noir Aztec tool
        uint256 input = 0x1234; // 4660 in decimal
        Field.Type fieldInput = Field.toField(input);
        Field.Type fieldResult = poseidon2.hash_1(fieldInput);
        uint256 result = Field.toUint256(fieldResult);
        
        console.log("=== POSEIDON2 HASH FOR 0x12344 ===");
        console.log("Input value (decimal): %s", input);
        console.log("Input value (hex): 0x%x", input);
        console.log("Poseidon2 hash result: %s", result);
        console.log("Poseidon2 hash result (hex): 0x%x", result);
        
        // Verify the result is not zero (basic sanity check)
        assertTrue(result != 0, "Hash result should not be zero");
        
        // This result can be compared with Noir Aztec tool online
        console.log("Compare this result with Noir Aztec tool online for 0x12344");
    }
}
