// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/Grumpkin.sol";
import "../src/Generators.sol";

contract GrumpkinTest is Test {
    using Grumpkin for Grumpkin.G1Point;

    function testCommitmentPointAddition() public {
        // Test with the specific commitment points from the circuit
        Grumpkin.G1Point memory C1 = Grumpkin.G1Point({
            x: 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b,
            y: 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746
        });
        
        Grumpkin.G1Point memory C2 = Grumpkin.G1Point({
            x: 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd,
            y: 0xb43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c
        });
        
        Grumpkin.G1Point memory C3 = Grumpkin.G1Point({
            x: 0x29ef727483c7cc3372c0cf6c28db5aeeb39631f06e3c347c26c9cbe21b2be93b,
            y: 0x29ba904778f0f6ac407889a6ca86dfcef08f3755e977e43e0f7dd598244e7fff
        });
        
        console.log("Testing commitment point addition:");
        console.log("C1.x =", C1.x);
        console.log("C1.y =", C1.y);
        console.log("C2.x =", C2.x);
        console.log("C2.y =", C2.y);
        console.log("C3.x =", C3.x);
        console.log("C3.y =", C3.y);
        
        // Test C1 + C2
        Grumpkin.G1Point memory C1_plus_C2 = Grumpkin.add(C1, C2);
        console.log("C1 + C2:");
        console.log("(C1+C2).x =", C1_plus_C2.x);
        console.log("(C1+C2).y =", C1_plus_C2.y);
      
        // Test that addition is commutative: C1 + C2 = C2 + C1
        Grumpkin.G1Point memory C2_plus_C1 = Grumpkin.add(C2, C1);
        assertTrue(Grumpkin.eq(C1_plus_C2, C2_plus_C1), "Point addition should be commutative");
        
        console.log("All commitment point additions completed successfully!");
    }


    function testZeroPointOperations() public {
        Grumpkin.G1Point memory zero = Grumpkin.G1Point(0, 0);
        
        // Test zero point properties
        assertTrue(Grumpkin.isZero(zero), "Zero point should be identified as zero");
        
        // Test operations with zero point
        Grumpkin.G1Point memory C1 = Grumpkin.G1Point({
            x: 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b,
            y: 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746
        });
        
        Grumpkin.G1Point memory sum = Grumpkin.add(C1, zero);
        assertTrue(Grumpkin.eq(sum, C1), "C1 + zero should equal C1");
        
        Grumpkin.G1Point memory sum2 = Grumpkin.add(zero, C1);
        assertTrue(Grumpkin.eq(sum2, C1), "zero + C1 should equal C1");
        
        console.log("Zero point operations test completed successfully!");
    }

    function testGasCost() public {
        // Test gas cost of a single point addition
        Grumpkin.G1Point memory C1 = Grumpkin.G1Point({
            x: 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b,
            y: 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746
        });
        
        Grumpkin.G1Point memory C2 = Grumpkin.G1Point({
            x: 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd,
            y: 0x0b43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c
        });
        
        // Measure gas cost of single addition
        uint256 gasStart = gasleft();
        Grumpkin.G1Point memory result = Grumpkin.add(C1, C2);
        uint256 gasUsed = gasStart - gasleft();
        
        console.log("Gas cost for single point addition:");
        console.log("Gas used:", gasUsed);
        console.log("Result x:", result.x);
        console.log("Result y:", result.y);
        
        // Verify result is correct
        assertTrue(!Grumpkin.isZero(result), "Addition result should not be zero");
        
        console.log("Gas cost measurements completed successfully!");
    }

    function testPointsOnCurve() public {
        // Test that the commitment points are actually on the Grumpkin curve
        // Curve equation: y^2 = x^3 - 17 (mod p)
        uint256 p = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
        
        // Test C1
        uint256 c1X = 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b;
        uint256 c1Y = 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746;
        
        uint256 c1ySquared = mulmod(c1Y, c1Y, p);
        uint256 c1xCubed = mulmod(mulmod(c1X, c1X, p), c1X, p);
        uint256 c1rhs = addmod(c1xCubed, p - 17, p); // x^3 - 17 mod p
        
        console.log("=== TESTING C1 ON GRUMPKIN CURVE ===");
        console.log("C1.x =", c1X);
        console.log("C1.y =", c1Y);
        console.log("C1: y^2 =", c1ySquared);
        console.log("C1: x^3 - 17 =", c1rhs);
        console.log("C1: y^2 == x^3 - 17?", c1ySquared == c1rhs);
        
        assertTrue(c1ySquared == c1rhs, "C1 should be on Grumpkin curve");
        
        // Test C2
        uint256 c2X = 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd;
        uint256 c2Y = 0x0b43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c;
        
        uint256 c2ySquared = mulmod(c2Y, c2Y, p);
        uint256 c2xCubed = mulmod(mulmod(c2X, c2X, p), c2X, p);
        uint256 c2rhs = addmod(c2xCubed, p - 17, p); // x^3 - 17 mod p
        
        console.log("=== TESTING C2 ON GRUMPKIN CURVE ===");
        console.log("C2.x =", c2X);
        console.log("C2.y =", c2Y);
        console.log("C2: y^2 =", c2ySquared);
        console.log("C2: x^3 - 17 =", c2rhs);
        console.log("C2: y^2 == x^3 - 17?", c2ySquared == c2rhs);
        
        assertTrue(c2ySquared == c2rhs, "C2 should be on Grumpkin curve");
        
        // Test C3 (the expected result of C1 + C2)
        uint256 c3X = 0x29ef727483c7cc3372c0cf6c28db5aeeb39631f06e3c347c26c9cbe21b2be93b;
        uint256 c3Y = 0x29ba904778f0f6ac407889a6ca86dfcef08f3755e977e43e0f7dd598244e7fff;
        
        uint256 c3ySquared = mulmod(c3Y, c3Y, p);
        uint256 c3xCubed = mulmod(mulmod(c3X, c3X, p), c3X, p);
        uint256 c3rhs = addmod(c3xCubed, p - 17, p); // x^3 - 17 mod p
        
        console.log("=== TESTING C3 ON GRUMPKIN CURVE ===");
        console.log("C3.x =", c3X);
        console.log("C3.y =", c3Y);
        console.log("C3: y^2 =", c3ySquared);
        console.log("C3: x^3 - 17 =", c3rhs);
        console.log("C3: y^2 == x^3 - 17?", c3ySquared == c3rhs);
        
        assertTrue(c3ySquared == c3rhs, "C3 should be on Grumpkin curve");
        
        // Test that C1 + C2 = C3 (both points and result are on curve)
        Grumpkin.G1Point memory C1 = Grumpkin.G1Point(c1X, c1Y);
        Grumpkin.G1Point memory C2 = Grumpkin.G1Point(c2X, c2Y);
        Grumpkin.G1Point memory C3 = Grumpkin.G1Point(c3X, c3Y);
        
        Grumpkin.G1Point memory C1_plus_C2 = Grumpkin.add(C1, C2);
        
        console.log("=== TESTING C1 + C2 = C3 ===");
        console.log("(C1+C2).x =", C1_plus_C2.x);
        console.log("(C1+C2).y =", C1_plus_C2.y);
        console.log("C3.x =", C3.x);
        console.log("C3.y =", C3.y);
        console.log("C1 + C2 == C3?", Grumpkin.eq(C1_plus_C2, C3));
        
        assertTrue(Grumpkin.eq(C1_plus_C2, C3), "C1 + C2 should equal C3");
        
        console.log("All points are verified to be on the Grumpkin curve!");
    }

    function testPedersenCommitmentWithOpeningValues() public view {
        // Test creating a Pedersen commitment with opening values (1, 2)
        // Third scalar is always 1, so D is added directly (no multiplication)
        uint256 scalar1 = 1;  // newNoteStackX
        uint256 scalar2 = 2;  // newNoteStackY
        uint256 scalar3 = 1;  // Always 1, so D is added directly
        
        // Get generators
        (uint256 gx, uint256 gy) = Generators.getG();
        (uint256 hx, uint256 hy) = Generators.getH();
        (uint256 dx, uint256 dy) = Generators.getD();
        
        Grumpkin.G1Point memory G = Grumpkin.G1Point(gx, gy);
        Grumpkin.G1Point memory H = Grumpkin.G1Point(hx, hy);
        Grumpkin.G1Point memory D = Grumpkin.G1Point(dx, dy);
        
        // Create Pedersen commitment: 1*G + 2*H + 1*D
        Grumpkin.G1Point memory commitment = Grumpkin.pedersenCommitment(
            G,
            H,
            D,
            scalar1,
            scalar2,
            scalar3
        );
        
        console.log("=== PEDERSEN COMMITMENT TEST ===");
        console.log("Opening values: (1, 2, 1)");
        console.log("Commitment.x =", commitment.x);
        console.log("Commitment.y =", commitment.y);
        
        // Verify commitment is on the Grumpkin curve
        uint256 p = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
        uint256 ySquared = mulmod(commitment.y, commitment.y, p);
        uint256 xCubed = mulmod(mulmod(commitment.x, commitment.x, p), commitment.x, p);
        uint256 rhs = addmod(xCubed, p - 17, p); // x^3 - 17 mod p
        
        console.log("Commitment: y^2 =", ySquared);
        console.log("Commitment: x^3 - 17 =", rhs);
        console.log("Commitment on curve?", ySquared == rhs);
        
        assertTrue(ySquared == rhs, "Commitment should be on Grumpkin curve");
        assertTrue(!Grumpkin.isZero(commitment), "Commitment should not be zero point");
        
        console.log("Pedersen commitment test completed successfully!");
    }

    function testPedersenCommitmentGasCost() public {
        // Test gas cost of creating a Pedersen commitment with opening values (1, 2)
        // Third scalar is always 1, so D is added directly (optimized path)
        uint256 scalar1 = 1;  // newNoteStackX
        uint256 scalar2 = 2;  // newNoteStackY
        
        // Get generators
        (uint256 gx, uint256 gy) = Generators.getG();
        (uint256 hx, uint256 hy) = Generators.getH();
        (uint256 dx, uint256 dy) = Generators.getD();
        
        Grumpkin.G1Point memory G = Grumpkin.G1Point(gx, gy);
        Grumpkin.G1Point memory H = Grumpkin.G1Point(hx, hy);
        Grumpkin.G1Point memory D = Grumpkin.G1Point(dx, dy);
        
        // Measure gas cost using the 2-arg convenience function
        uint256 gasStart = gasleft();
        
        Grumpkin.G1Point memory commitment = Grumpkin.pedersenCommitmentWithD(
            G,
            H,
            D,
            scalar1,
            scalar2
        );
        
        uint256 gasUsed = gasStart - gasleft();
        
        console.log("=== PEDERSEN COMMITMENT GAS COST (2 args) ===");
        console.log("Opening values: (1, 2) - D is always added directly");
        console.log("Gas used:", gasUsed);
        console.log("Commitment.x =", commitment.x);
        console.log("Commitment.y =", commitment.y);
        
        // Verify result is valid
        assertTrue(!Grumpkin.isZero(commitment), "Commitment should not be zero point");
        
        // Verify commitment is on the Grumpkin curve
        uint256 p = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
        uint256 ySquared = mulmod(commitment.y, commitment.y, p);
        uint256 xCubed = mulmod(mulmod(commitment.x, commitment.x, p), commitment.x, p);
        uint256 rhs = addmod(xCubed, p - 17, p);
        assertTrue(ySquared == rhs, "Commitment should be on Grumpkin curve");
        
        console.log("Gas cost measurement completed successfully!");
    }

    function testPedersenCommitmentOptimization() public view {
        // Test that when scalar3 = 1, D is added directly (no multiplication)
        // Compare: 1*G + 2*H + 1*D vs manual calculation
        
        uint256 scalar1 = 1;
        uint256 scalar2 = 2;
        uint256 scalar3 = 1;
        
        // Get generators
        (uint256 gx, uint256 gy) = Generators.getG();
        (uint256 hx, uint256 hy) = Generators.getH();
        (uint256 dx, uint256 dy) = Generators.getD();
        
        Grumpkin.G1Point memory G = Grumpkin.G1Point(gx, gy);
        Grumpkin.G1Point memory H = Grumpkin.G1Point(hx, hy);
        Grumpkin.G1Point memory D = Grumpkin.G1Point(dx, dy);
        
        // Using pedersenCommitment (optimized: scalar3 = 1 adds D directly)
        Grumpkin.G1Point memory commitment = Grumpkin.pedersenCommitment(
            G,
            H,
            D,
            scalar1,
            scalar2,
            scalar3
        );
        
        // Manual calculation: 1*G + 2*H + 1*D
        Grumpkin.G1Point memory term1 = Grumpkin.mul(G, scalar1);  // 1*G
        Grumpkin.G1Point memory term2 = Grumpkin.mul(H, scalar2);  // 2*H
        Grumpkin.G1Point memory temp = Grumpkin.add(term1, term2);
        Grumpkin.G1Point memory manualResult = Grumpkin.add(temp, D);  // + D (since scalar3 = 1)
        
        console.log("=== PEDERSEN COMMITMENT OPTIMIZATION TEST ===");
        console.log("Optimized commitment.x =", commitment.x);
        console.log("Optimized commitment.y =", commitment.y);
        console.log("Manual calculation.x =", manualResult.x);
        console.log("Manual calculation.y =", manualResult.y);
        console.log("Results match?", Grumpkin.eq(commitment, manualResult));
        
        assertTrue(Grumpkin.eq(commitment, manualResult), "Optimized and manual results should match");
        
        console.log("Optimization test completed successfully!");
    }

    function testGasCostComparison() public {
        // Get generators
        (uint256 gx, uint256 gy) = Generators.getG();
        (uint256 hx, uint256 hy) = Generators.getH();
        (uint256 dx, uint256 dy) = Generators.getD();
        
        Grumpkin.G1Point memory G = Grumpkin.G1Point(gx, gy);
        Grumpkin.G1Point memory H = Grumpkin.G1Point(hx, hy);
        Grumpkin.G1Point memory D = Grumpkin.G1Point(dx, dy);
        
        // Test points for addition
        Grumpkin.G1Point memory P1 = Grumpkin.G1Point({
            x: 0x1b7294b1b37bfbe1abf49c1a0312171aad6651b8fd5a2c0a4b7a11f4eab38d2b,
            y: 0x213d5e429b7c8acc31dfd675ec11e6d7c95af5b15bc5e33439a633259fe51746
        });
        
        Grumpkin.G1Point memory P2 = Grumpkin.G1Point({
            x: 0x291b09c5a374db49d112289916c7ddb1b208d82998f5a7ab2af334f592377dbd,
            y: 0x0b43ab1a8c23fda6d99721e86e7ad15b8c62579d026d19849fea713f8b005d0c
        });
        
        uint256 scalar1 = 1;
        uint256 scalar2 = 2;
        
        console.log("=== GAS COST COMPARISON ===");
        console.log("");
        
        // 1. Test Addition Cost
        uint256 gasStart = gasleft();
        Grumpkin.G1Point memory addResult = Grumpkin.add(P1, P2);
        uint256 addGasUsed = gasStart - gasleft();
        
        console.log("1. POINT ADDITION");
        console.log("   Gas used:", addGasUsed);
        console.log("   Result.x =", addResult.x);
        console.log("   Result.y =", addResult.y);
        console.log("");
        
        // 2. Test Multiplication Cost (scalar1 * G)
        gasStart = gasleft();
        Grumpkin.G1Point memory mulResult1 = Grumpkin.mul(G, scalar1);
        uint256 mulGasUsed1 = gasStart - gasleft();
        
        console.log("2. SCALAR MULTIPLICATION (1 * G)");
        console.log("   Gas used:", mulGasUsed1);
        console.log("   Result.x =", mulResult1.x);
        console.log("   Result.y =", mulResult1.y);
        console.log("");
        
        // 3. Test Multiplication Cost (scalar2 * H)
        gasStart = gasleft();
        Grumpkin.G1Point memory mulResult2 = Grumpkin.mul(H, scalar2);
        uint256 mulGasUsed2 = gasStart - gasleft();
        
        console.log("3. SCALAR MULTIPLICATION (2 * H)");
        console.log("   Gas used:", mulGasUsed2);
        console.log("   Result.x =", mulResult2.x);
        console.log("   Result.y =", mulResult2.y);
        console.log("");
        
        // 4. Test Pedersen Commitment Cost (using 2-arg function)
        gasStart = gasleft();
        Grumpkin.G1Point memory pedersenResult = Grumpkin.pedersenCommitmentWithD(
            G,
            H,
            D,
            scalar1,
            scalar2
        );
        uint256 pedersenGasUsed = gasStart - gasleft();
        
        console.log("4. PEDERSEN COMMITMENT (1*G + 2*H + D)");
        console.log("   Gas used:", pedersenGasUsed);
        console.log("   Result.x =", pedersenResult.x);
        console.log("   Result.y =", pedersenResult.y);
        console.log("");
        
        // 5. Calculate theoretical cost (2 muls + 2 adds)
        uint256 theoreticalCost = mulGasUsed1 + mulGasUsed2 + (addGasUsed * 2);
        
        console.log("=== COST BREAKDOWN ===");
        console.log("Addition cost:", addGasUsed);
        console.log("Multiplication (1*G) cost:", mulGasUsed1);
        console.log("Multiplication (2*H) cost:", mulGasUsed2);
        console.log("Theoretical total (2 muls + 2 adds):", theoreticalCost);
        console.log("Actual Pedersen commitment cost:", pedersenGasUsed);
        console.log("Overhead:", pedersenGasUsed > theoreticalCost ? pedersenGasUsed - theoreticalCost : 0);
        console.log("");
        
        // Verify results are correct
        assertTrue(!Grumpkin.isZero(addResult), "Addition result should not be zero");
        assertTrue(!Grumpkin.isZero(mulResult1), "Multiplication result 1 should not be zero");
        assertTrue(!Grumpkin.isZero(mulResult2), "Multiplication result 2 should not be zero");
        assertTrue(!Grumpkin.isZero(pedersenResult), "Pedersen commitment should not be zero");
        
        // Verify Pedersen commitment matches manual calculation
        Grumpkin.G1Point memory manualTerm1 = Grumpkin.mul(G, scalar1);
        Grumpkin.G1Point memory manualTerm2 = Grumpkin.mul(H, scalar2);
        Grumpkin.G1Point memory manualSum = Grumpkin.add(manualTerm1, manualTerm2);
        Grumpkin.G1Point memory manualResult = Grumpkin.add(manualSum, D);
        
        assertTrue(
            Grumpkin.eq(pedersenResult, manualResult),
            "Pedersen commitment should match manual calculation"
        );
        
        console.log("All gas cost measurements completed successfully!");
    }
}
