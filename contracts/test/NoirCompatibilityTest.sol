// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/Nydus.sol";
import "../src/Grumpkin.sol";

contract NoirCompatibilityTest is Test {
    Nydus public nydus;
    address[] public verifiers;
    
    function setUp() public {
        verifiers = new address[](1);
        verifiers[0] = address(0x123);
        nydus = new Nydus(verifiers);
    }
    
    function testNoirCommitmentValidity() public {
        // Test if the Noir commitment values are valid Grumpkin points
        uint256 c1X = 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b;
        uint256 c1Y = 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746;
        uint256 c2X = 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd;
        uint256 c2Y = 0x0b43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c;
        
        console.log("=== TESTING NOIR COMMITMENT VALIDITY ===");
        
        // Test C1
        Grumpkin.G1Point memory c1 = Grumpkin.G1Point({x: c1X, y: c1Y});
        console.log("C1 is zero:", Grumpkin.isZero(c1));
        
        // Test C2
        Grumpkin.G1Point memory c2 = Grumpkin.G1Point({x: c2X, y: c2Y});
        console.log("C2 is zero:", Grumpkin.isZero(c2));
        
        // Manual curve equation check for C1: y^2 = x^3 - 17 (Grumpkin curve)
        uint256 p = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
        uint256 ySquared = mulmod(c1Y, c1Y, p);
        uint256 xCubed = mulmod(mulmod(c1X, c1X, p), c1X, p);
        uint256 rhs = addmod(xCubed, p - 17, p); // x^3 - 17 mod p
        
        console.log("C1: y^2 =", ySquared);
        console.log("C1: x^3 - 17 =", rhs);
        console.log("C1: y^2 == x^3 - 17?", ySquared == rhs);
        
        // Manual curve equation check for C2
        uint256 c2ySquared = mulmod(c2Y, c2Y, p);
        uint256 c2xCubed = mulmod(mulmod(c2X, c2X, p), c2X, p);
        uint256 c2rhs = addmod(c2xCubed, p - 17, p);
        
        console.log("C2: y^2 =", c2ySquared);
        console.log("C2: x^3 - 17 =", c2rhs);
        console.log("C2: y^2 == x^3 - 17?", c2ySquared == c2rhs);
        
        // Test point addition
        Grumpkin.G1Point memory result = Grumpkin.add(c1, c2);
        console.log("C1 + C2.x =", result.x);
        console.log("C1 + C2.y =", result.y);
        console.log("C1 + C2 is zero:", Grumpkin.isZero(result));
        
        console.log("=== END VALIDITY TEST ===");
    }
    
    function testGrumpkinOperations() public {
        // Test basic Grumpkin operations
        console.log("=== GRUMPKIN OPERATIONS TEST ===");
        
        // Test with the known commitment points
        Grumpkin.G1Point memory c1 = Grumpkin.G1Point({
            x: 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b,
            y: 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746
        });
        
        Grumpkin.G1Point memory c2 = Grumpkin.G1Point({
            x: 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd,
            y: 0x0b43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c
        });
        
        // Test point addition
        Grumpkin.G1Point memory result = Grumpkin.add(c1, c2);
        console.log("C1 + C2.x =", result.x);
        console.log("C1 + C2.y =", result.y);
        console.log("C1 + C2 is zero:", Grumpkin.isZero(result));
        
        // Test scalar multiplication
        Grumpkin.G1Point memory scaled = Grumpkin.mul(c1, 5);
        console.log("5*C1.x =", scaled.x);
        console.log("5*C1.y =", scaled.y);
        console.log("5*C1 is zero:", Grumpkin.isZero(scaled));
        
        console.log("=== END GRUMPKIN OPERATIONS TEST ===");
    }
    
    function testNydusIntegration() public {
        // Test integration with Nydus contract
        console.log("=== NYDUS INTEGRATION TEST ===");
        
        // Test the addCommitments function in Nydus
        uint256 c1X = 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b;
        uint256 c1Y = 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746;
        uint256 c2X = 0x0bc6f794fe53f0c8704d41006c06065f765e884d12ea6841895866f6a7796568;
        uint256 c2Y = 0x22539c9ee4342d7eaa4c5a67d5cb0c93ddf1e9e03c173e6a4e442b5d57a2b5bd;
        
        (uint256 resultX, uint256 resultY) = nydus.addCommitments(c1X, c1Y, c2X, c2Y);
        
        console.log("Nydus addCommitments result.x =", resultX);
        console.log("Nydus addCommitments result.y =", resultY);
        
        // Test verification function
        bool isValid = nydus.verifyGrumpkinCommitment(resultX, resultY);
        console.log("Result is valid:", isValid);
        
        console.log("=== END NYDUS INTEGRATION TEST ===");
    }
}
