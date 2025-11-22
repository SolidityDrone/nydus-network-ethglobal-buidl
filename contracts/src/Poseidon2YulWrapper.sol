// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "../lib/poseidon2-evm/src/Poseidon2Yul.sol";
import "../lib/poseidon2-evm/src/Field.sol";

/**
 * @title Poseidon2YulWrapper
 * @dev Wrapper for Poseidon2Yul that provides the standard interface
 * @notice This wrapper converts the fallback-based Yul contract to standard method calls
 */
contract Poseidon2YulWrapper {
    Poseidon2Yul public immutable poseidon2Yul;
    
    constructor() {
        poseidon2Yul = new Poseidon2Yul();
    }
    
    /**
     * @dev Hash a single field element using Poseidon2Yul
     * @param x The field element to hash
     * @return The hash result
     */
    function hash_1(Field.Type x) public view returns (Field.Type) {
        uint256 input = Field.toUint256(x);
        bytes memory data = abi.encode(input);
        
        (bool success, bytes memory result) = address(poseidon2Yul).staticcall(data);
        require(success, "Poseidon2Yul call failed");
        
        uint256 output = abi.decode(result, (uint256));
        return Field.toField(output);
    }
    
    /**
     * @dev Hash two field elements using Poseidon2Yul
     * @param x First field element
     * @param y Second field element
     * @return The hash result
     */
    function hash_2(Field.Type x, Field.Type y) public view returns (Field.Type) {
        uint256 input1 = Field.toUint256(x);
        uint256 input2 = Field.toUint256(y);
        bytes memory data = abi.encode(input1, input2);
        
        (bool success, bytes memory result) = address(poseidon2Yul).staticcall(data);
        require(success, "Poseidon2Yul call failed");
        
        uint256 output = abi.decode(result, (uint256));
        return Field.toField(output);
    }
    
    /**
     * @dev Hash three field elements using Poseidon2Yul
     * @param x First field element
     * @param y Second field element
     * @param z Third field element
     * @return The hash result
     */
    function hash_3(Field.Type x, Field.Type y, Field.Type z) public view returns (Field.Type) {
        uint256 input1 = Field.toUint256(x);
        uint256 input2 = Field.toUint256(y);
        uint256 input3 = Field.toUint256(z);
        bytes memory data = abi.encode(input1, input2, input3);
        
        (bool success, bytes memory result) = address(poseidon2Yul).staticcall(data);
        require(success, "Poseidon2Yul call failed");
        
        uint256 output = abi.decode(result, (uint256));
        return Field.toField(output);
    }
    
    /**
     * @dev Hash an array of field elements using Poseidon2Yul
     * @param input Array of field elements
     * @return The hash result
     */
    function hash(Field.Type[] memory input) public view returns (Field.Type) {
        uint256[] memory inputs = new uint256[](input.length);
        for (uint256 i = 0; i < input.length; i++) {
            inputs[i] = Field.toUint256(input[i]);
        }
        
        bytes memory data = abi.encode(inputs);
        
        (bool success, bytes memory result) = address(poseidon2Yul).staticcall(data);
        require(success, "Poseidon2Yul call failed");
        
        uint256 output = abi.decode(result, (uint256));
        return Field.toField(output);
    }
}
