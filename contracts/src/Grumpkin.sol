// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

/**
 * @title Grumpkin
 * @dev Gas-optimized Grumpkin curve point operations
 * @notice This library provides basic point addition for Grumpkin curve points
 * Curve equation: y^2 = x^3 - 17
 * Field modulus: BN254 scalar field
 */
library Grumpkin {
    // Grumpkin field modulus (BN254 scalar field)
    uint256 private constant P_MOD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    
    struct G1Point {
        uint256 x;
        uint256 y;
    }

    /**
     * @dev Add two G1 points (gas optimized)
     * Uses EVM's modexp precompile (0x05) for inverse calculation
     */
    function add(G1Point memory p1, G1Point memory p2) internal view returns (G1Point memory r) {
        assembly {
            function point_add(x1, y1, x2, y2) -> rx, ry {
                let p := 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
                
                // Handle point at infinity (0,0)
                if and(iszero(x1), iszero(y1)) {
                    rx := x2
                    ry := y2
                    leave
                }
                if and(iszero(x2), iszero(y2)) {
                    rx := x1
                    ry := y1
                    leave
                }
                
                // Check if points are negations (result is point at infinity)
                if and(eq(x1, x2), eq(addmod(y1, y2, p), 0)) {
                    rx := 0
                    ry := 0
                    leave
                }
                
                // Check if doubling
                if and(eq(x1, x2), eq(y1, y2)) {
                    // Point doubling formula: slope = (3*x^2) / (2*y)
                    if iszero(y1) {
                        rx := 0
                        ry := 0
                        leave
                    }
                    
                    let x_sq := mulmod(x1, x1, p)
                    let numerator := mulmod(3, x_sq, p)
                    let denominator := mulmod(2, y1, p)
                    
                    // Use modexp precompile for inverse: denominator^(p-2) mod p
                    // Get free memory pointer and use it
                    let memPtr := mload(0x40)
                    mstore(memPtr, 0x20)                      // length of base
                    mstore(add(memPtr, 0x20), 0x20)           // length of exponent
                    mstore(add(memPtr, 0x40), 0x20)           // length of modulus
                    mstore(add(memPtr, 0x60), denominator)    // base
                    mstore(add(memPtr, 0x80), sub(p, 2))     // exponent = p - 2
                    mstore(add(memPtr, 0xa0), p)              // modulus
                    
                    let success := staticcall(gas(), 0x05, memPtr, 0xc0, memPtr, 0x20)
                    if iszero(success) {
                        revert(0, 0)
                    }
                    let inv := mload(memPtr)
                    
                    let slope := mulmod(numerator, inv, p)
                    let slope_sq := mulmod(slope, slope, p)
                    
                    rx := addmod(slope_sq, sub(p, mulmod(2, x1, p)), p)
                    ry := addmod(mulmod(slope, addmod(x1, sub(p, rx), p), p), sub(p, y1), p)
                    leave
                }
                
                // Point addition
                let x_diff := addmod(x2, sub(p, x1), p)
                let y_diff := addmod(y2, sub(p, y1), p)
                
                // Use modexp precompile for inverse: x_diff^(p-2) mod p
                // Get free memory pointer and use it
                let memPtr := mload(0x40)
                mstore(memPtr, 0x20)                      // length of base
                mstore(add(memPtr, 0x20), 0x20)           // length of exponent
                mstore(add(memPtr, 0x40), 0x20)           // length of modulus
                mstore(add(memPtr, 0x60), x_diff)         // base
                mstore(add(memPtr, 0x80), sub(p, 2))     // exponent = p - 2
                mstore(add(memPtr, 0xa0), p)              // modulus
                
                let success := staticcall(gas(), 0x05, memPtr, 0xc0, memPtr, 0x20)
                if iszero(success) {
                    revert(0, 0)
                }
                let inv := mload(memPtr)
                
                let slope := mulmod(y_diff, inv, p)
                let slope_sq := mulmod(slope, slope, p)
                
                rx := addmod(addmod(slope_sq, sub(p, x1), p), sub(p, x2), p)
                ry := addmod(mulmod(slope, addmod(x1, sub(p, rx), p), p), sub(p, y1), p)
            }
            
            let x1 := mload(p1)
            let y1 := mload(add(p1, 0x20))
            let x2 := mload(p2)
            let y2 := mload(add(p2, 0x20))
            
            let rx, ry := point_add(x1, y1, x2, y2)
            
            mstore(r, rx)
            mstore(add(r, 0x20), ry)
        }
    }


    /**
     * @dev Scalar multiplication using double-and-add
     */
    function mul(G1Point memory p, uint256 scalar) internal view returns (G1Point memory r) {
        r = G1Point(0, 0);
        G1Point memory temp = p;
        
        while (scalar > 0) {
            if (scalar & 1 == 1) {
                r = add(r, temp);
            }
            temp = add(temp, temp);
            scalar >>= 1;
        }
    }

    /**
     * @dev Check if two G1 points are equal
     */
    function eq(G1Point memory p1, G1Point memory p2) internal pure returns (bool) {
        return p1.x == p2.x && p1.y == p2.y;
    }

    /**
     * @dev Check if a G1 point is the zero point
     */
    function isZero(G1Point memory p) internal pure returns (bool) {
        return p.x == 0 && p.y == 0;
    }

    /**
     * @dev Negate a G1 point (point at infinity remains unchanged)
     */
    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (p.x == 0 && p.y == 0) {
            return p; // Point at infinity
        }
        uint256 p_mod = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
        return G1Point(p.x, addmod(0, p_mod - p.y, p_mod));
    }

    /**
     * @dev Compute Pedersen commitment with 3 generators: scalar1*G + scalar2*H + scalar3*D
     * Optimized: skips D when scalar3 is 0, adds D directly when scalar3 is 1 (no multiplication)
     * @param G First generator point
     * @param H Second generator point
     * @param D Third generator point
     * @param scalar1 First scalar multiplier
     * @param scalar2 Second scalar multiplier
     * @param scalar3 Third scalar multiplier
     * @return result The resulting commitment point
     */
    function pedersenCommitment(
        G1Point memory G,
        G1Point memory H,
        G1Point memory D,
        uint256 scalar1,
        uint256 scalar2,
        uint256 scalar3
    ) internal view returns (G1Point memory result) {
        // Compute scalar1 * G
        G1Point memory term1 = mul(G, scalar1);
        
        // Compute scalar2 * H
        G1Point memory term2 = mul(H, scalar2);
        
        // Add first two terms
        result = add(term1, term2);
        
        // Optimize third term: skip if 0, add D directly if 1, multiply otherwise
        if (scalar3 == 0) {
            // Skip D entirely (scalar3 * D = point at infinity)
            return result;
        } else if (scalar3 == 1) {
            // Just add D directly (1 * D = D, no multiplication needed)
            result = add(result, D);
        } else {
            // Compute scalar3 * D for scalar3 > 1
            G1Point memory term3 = mul(D, scalar3);
            result = add(result, term3);
        }
    }

    /**
     * @dev Compute Pedersen commitment with 2 scalars (third scalar is always 1): scalar1*G + scalar2*H + D
     * Optimized convenience function for note stack commitments where D is always added directly
     * @param G First generator point
     * @param H Second generator point
     * @param D Third generator point (added directly, no multiplication)
     * @param scalar1 First scalar multiplier
     * @param scalar2 Second scalar multiplier
     * @return result The resulting commitment point
     */
    function pedersenCommitmentWithD(
        G1Point memory G,
        G1Point memory H,
        G1Point memory D,
        uint256 scalar1,
        uint256 scalar2
    ) internal view returns (G1Point memory result) {
        // Compute scalar1 * G
        G1Point memory term1 = mul(G, scalar1);
        
        // Compute scalar2 * H
        G1Point memory term2 = mul(H, scalar2);
        
        // Add first two terms
        result = add(term1, term2);
        
        // Add D directly (scalar3 = 1, so 1 * D = D, no multiplication needed)
        result = add(result, D);
    }
}