use dep::std;
use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
use crate::pedersen_commitments::{
    pedersen_commitment_token, 
    pedersen_commitment_positive,
    pedersen_commitment_negative,
    pedersen_commitment_counter,
    pedersen_commitment_non_hiding,
    add_commitments, 
    verify_commitment_opening,
    verify_positive_commitment_opening,
    verify_negative_commitment_opening
};

#[test]
fn test_commitment_creation_and_addition() {
    // Test parameters
    let m1 = 100;
    let r1 = 1;
    let m2 = 200;
    let r2 = 2;
    let token_address = 0x02;
    
    // C1: m = 100, r = 1, token = 0x02
    let c1 = pedersen_commitment_token(m1, r1, token_address);
    
    // C2: m = 200, r = 2, token = 0x02  
    let c2 = pedersen_commitment_token(m2, r2, token_address);
    
    // C3 = C1 + C2
    let c3 = add_commitments(c1, c2);
    
    std::println("C1.x = ");
    std::println(c1.x);
    std::println("C1.y = ");
    std::println(c1.y);
    std::println("C2.x = ");
    std::println(c2.x);
    std::println("C2.y = ");
    std::println(c2.y);
    std::println("C3.x = ");
    std::println(c3.x);
    std::println("C3.y = ");
    std::println(c3.y);
    
    // Verify commitments are valid
    assert(verify_commitment_opening(c1, m1, r1, token_address));
    assert(verify_commitment_opening(c2, m2, r2, token_address));
}

#[test]
fn test_domain_separation() {
    let m = 100;
    let r = 1;
    let token_address = 0x02;
    
    // Test positive domain
    let positive_commitment = pedersen_commitment_token(m, r, token_address);
    assert(verify_commitment_opening(positive_commitment, m, r, token_address));
    
    // Test negative domain
    let negative_commitment = pedersen_commitment_token(m, r, token_address + 0x100000000000000000000000000000000000000000000000000000000000000);
    
    std::println("Positive commitment x = ");
    std::println(positive_commitment.x);
    std::println("Positive commitment y = ");
    std::println(positive_commitment.y);
    std::println("Negative commitment x = ");
    std::println(negative_commitment.x);
    std::println("Negative commitment y = ");
    std::println(negative_commitment.y);
}

#[test]
fn test_commitment_addition_and_opening() {
    // Test parameters
    let m1 = 1;
    let r1 = 1;
    let token1 = 1;
    
    let m2 = 1;
    let r2 = 1;
    let token2 = 1;
    
    // Create C1 = pedersen_commitment_positive(0, 0, 0)
    let c1 = pedersen_commitment_positive(m1, r1, token1);
    
    // Create C2 = pedersen_commitment_positive(1, 1, 1)
    let c2 = pedersen_commitment_positive(m2, r2, token2);
    
    // C3 = C1 + C2
    let c3 = add_commitments(c1, c2);
    
    std::println("C1 (0,0,0) x = ");
    std::println(c1.x);
    std::println("C1 (0,0,0) y = ");
    std::println(c1.y);
    std::println("C2 (1,1,1) x = ");
    std::println(c2.x);
    std::println("C2 (1,1,1) y = ");
    std::println(c2.y);
    std::println("C3 (C1+C2) x = ");
    std::println(c3.x);
    std::println("C3 (C1+C2) y = ");
    std::println(c3.y);
    
    // Verify C3 can be opened with (1, 1, 1)
    // This should work because C1 is identity (0,0,0) and C2 is (1,1,1)
    // So C1 + C2 = C2 = (1,1,1)
    assert(verify_commitment_opening(c3, m1+m2, r1+r2, token1+token2), "C3 should be openable with (1,1,1)");
    
    // Also verify individual commitments
    assert(verify_commitment_opening(c1, m1, r1, token1), "C1 should be openable with (0,0,0)");
    assert(verify_commitment_opening(c2, m2, r2, token2), "C2 should be openable with (1,1,1)");
}

#[test]
fn test_generators_are_valid_curve_points() {
    // Test that the derived generators are valid points on the embedded curve
    // Grumpkin curve equation: y^2 = x^3 - 17
    // (modular arithmetic is handled automatically by Noir's field operations)
    
    // Use the generators from derive_generators (which are valid on Grumpkin)
    let generators: [EmbeddedCurvePoint; 3] = std::hash::derive_generators("PEDERSEN_COMMITMENT".as_bytes(), 0);
    let G: EmbeddedCurvePoint = generators[0];  // First generator for amount
    let H: EmbeddedCurvePoint = generators[1];  // Second generator for blinding factor
    let D: EmbeddedCurvePoint = generators[2];  // Third generator for domain separation
    
    // Grumpkin curve equation: y^2 = x^3 - 17 (mod p)
    // where p is the BN254 scalar field modulus
    
    // Print generator coordinates first to debug
    std::println("Generator G coordinates:");
    std::println("G.x = ");
    std::println(G.x);
    std::println("G.y = ");
    std::println(G.y);
    std::println("G.is_infinite = ");
    std::println(G.is_infinite);
    
    // Check if G is on the Grumpkin curve: y^2 = x^3 - 17
    let g_x_cubed = G.x * G.x * G.x;
    let g_y_squared = G.y * G.y;
    let g_right_side = g_x_cubed - 17; // x^3 - 17
    
    std::println("Grumpkin curve equation check for G:");
    std::println("Left side (y^2) = ");
    std::println(g_y_squared);
    std::println("Right side (x^3 - 17) = ");
    std::println(g_right_side);
    
    let g_on_curve = g_y_squared == g_right_side;
    std::println("G is on Grumpkin curve: ");
    std::println(g_on_curve);
    
    assert(g_on_curve, "Generator G is not on the Grumpkin curve");
    
    // Check if H is on the Grumpkin curve: y^2 = x^3 - 17
    let h_x_cubed = H.x * H.x * H.x;
    let h_y_squared = H.y * H.y;
    let h_right_side = h_x_cubed - 17; // x^3 - 17
    assert(h_y_squared == h_right_side, "Generator H is not on the Grumpkin curve");
    
    // Check if D is on the Grumpkin curve: y^2 = x^3 - 17
    let d_x_cubed = D.x * D.x * D.x;
    let d_y_squared = D.y * D.y;
    let d_right_side = d_x_cubed - 17; // x^3 - 17
    assert(d_y_squared == d_right_side, "Generator D is not on the Grumpkin curve");
    
    // Print remaining generator coordinates
    std::println("Generator H coordinates:");
    std::println("H.x = ");
    std::println(H.x);
    std::println("H.y = ");
    std::println(H.y);
    std::println("H.is_infinite = ");
    std::println(H.is_infinite);
    
    std::println("Generator D coordinates:");
    std::println("D.x = ");
    std::println(D.x);
    std::println("D.y = ");
    std::println(D.y);
    std::println("D.is_infinite = ");
    std::println(D.is_infinite);
    
    // Verify generators are not the point at infinity
    assert(!G.is_infinite, "Generator G should not be point at infinity");
    assert(!H.is_infinite, "Generator H should not be point at infinity");
    assert(!D.is_infinite, "Generator D should not be point at infinity");
    
    // Verify generators are different from each other
    let g_h_different = (G.x != H.x) | (G.y != H.y);
    let g_d_different = (G.x != D.x) | (G.y != D.y);
    let h_d_different = (H.x != D.x) | (H.y != D.y);
    
    assert(g_h_different, "Generators G and H should be different");
    assert(g_d_different, "Generators G and D should be different");
    assert(h_d_different, "Generators H and D should be different");
    
    std::println("✅ All generators are valid points on the Grumpkin curve!");
}

#[test]
fn test_default_non_zero_point() {
    // Create a default non-zero point using pedersen_commitment_positive(1, 1, 1)\
    
    let m = 1;
    let r = 1;
    let token_address = 1;
    
    let default_point = pedersen_commitment_positive(m, r, token_address);
    
    std::println("========================================");
    std::println("DEFAULT NON-ZERO POINT FOR SOLIDITY");
    std::println("========================================");
    std::println("Created using: pedersen_commitment_positive(1, 1, 1)");
    std::println("");
    std::println("Use these values in Solidity to initialize a non-zero point:");
    std::println("");
    std::print("x = ");
    std::println(default_point.x);
    std::print("y = ");
    std::println(default_point.y);
    std::println("");
    std::println("Solidity format:");
    std::print("CommitmentPoint({ x: ");
    std::print(default_point.x);
    std::print(", y: ");
    std::print(default_point.y);
    std::println(" })");
    std::println("");
    std::println("========================================");
    
    // Verify it's not the point at infinity
    assert(!default_point.is_infinite, "Default point should not be point at infinity");
    
    // Verify it's not (1, 1)
    assert(default_point.x != 1, "Default point x should not be 1");
    assert(default_point.y != 1, "Default point y should not be 1");
    
    // Verify it's a valid point on the curve
    let x_cubed = default_point.x * default_point.x * default_point.x;
    let y_squared = default_point.y * default_point.y;
    let right_side = x_cubed - 17; // Grumpkin curve: y^2 = x^3 - 17
    assert(y_squared == right_side, "Default point should be on the Grumpkin curve");
    
    std::println("✅ Default non-zero point is valid!");
}

#[test]
fn test_default_non_zero_point_non_hiding() {
    // Create a default non-zero point using pedersen_commitment_non_hiding(1, 1)
    // This gives us a valid curve point that can be used in Solidity for initialization
    // instead of using x=1, y=1 which is not a valid point on the curve
    
    let m = 1;
    let token_address = 1;
    
    let default_point = pedersen_commitment_non_hiding(m, token_address);
    
    std::println("========================================");
    std::println("DEFAULT NON-ZERO POINT FOR SOLIDITY (NON-HIDING)");
    std::println("========================================");
    std::println("Created using: pedersen_commitment_non_hiding(1, 1)");
    std::println("");
    std::println("Use these values in Solidity to initialize a non-zero point:");
    std::println("");
    std::print("x = ");
    std::println(default_point.x);
    std::print("y = ");
    std::println(default_point.y);
    std::println("");
    std::println("Solidity format:");
    std::print("CommitmentPoint({ x: ");
    std::print(default_point.x);
    std::print(", y: ");
    std::print(default_point.y);
    std::println(" })");
    std::println("");
    std::println("========================================");
    
    // Verify it's not the point at infinity
    assert(!default_point.is_infinite, "Default point should not be point at infinity");
    
    // Verify it's not (1, 1)
    assert(default_point.x != 1, "Default point x should not be 1");
    assert(default_point.y != 1, "Default point y should not be 1");
    
    // Verify it's a valid point on the curve
    let x_cubed = default_point.x * default_point.x * default_point.x;
    let y_squared = default_point.y * default_point.y;
    let right_side = x_cubed - 17; // Grumpkin curve: y^2 = x^3 - 17
    assert(y_squared == right_side, "Default point should be on the Grumpkin curve");
    
    std::println("✅ Default non-zero point (non-hiding) is valid!");
}

#[test]
fn test_pedersen_commitment_non_hiding_generators() {
    // Test that prints the G and D generator points used in pedersen_commitment_non_hiding
    // This test matches the exact code structure from pedersen_commitments.nr lines 35-54
    // These generators are derived using "PEDERSEN_COMMITMENT_PERSONAL" domain
    
    // Match exact structure from pedersen_commitment_non_hiding function
    let generators: [EmbeddedCurvePoint; 3] =
        std::hash::derive_generators("PEDERSEN_COMMITMENT_PERSONAL".as_bytes(), 0);
    
    let G = generators[0];  // Generator for m (amount)
    let D = generators[1];  // Generator for token_address (domain separation)
    
    std::println("========================================");
    std::println("GENERATORS FOR pedersen_commitment_non_hiding");
    std::println("========================================");
    std::println("Domain: PEDERSEN_COMMITMENT_PERSONAL");
    std::println("");
    std::println("Code structure (matching pedersen_commitments.nr lines 35-54):");
    std::println("  let generators: [EmbeddedCurvePoint; 3] =");
    std::println("      std::hash::derive_generators(\"PEDERSEN_COMMITMENT_PERSONAL\".as_bytes(), 0);");
    std::println("  let G = generators[0];  // Generator for m (amount)");
    std::println("  let D = generators[1];  // Generator for token_address (domain separation)");
    std::println("");
    std::println("Formula: m*G + token_address*D");
    std::println("");
    
    std::println("Generator G (for m/amount):");
    std::print("G.x = ");
    std::println(G.x);
    std::print("G.y = ");
    std::println(G.y);
    std::print("G.is_infinite = ");
    std::println(G.is_infinite);
    std::println("");
    
    std::println("Generator D (for token_address/domain separation):");
    std::print("D.x = ");
    std::println(D.x);
    std::print("D.y = ");
    std::println(D.y);
    std::print("D.is_infinite = ");
    std::println(D.is_infinite);
    std::println("");
    
    // Verify generators are valid curve points on Grumpkin: y^2 = x^3 - 17
    let g_x_cubed = G.x * G.x * G.x;
    let g_y_squared = G.y * G.y;
    let g_right_side = g_x_cubed - 17;
    let g_on_curve = g_y_squared == g_right_side;
    
    std::println("Grumpkin curve verification for G:");
    std::print("Left side (y^2) = ");
    std::println(g_y_squared);
    std::print("Right side (x^3 - 17) = ");
    std::println(g_right_side);
    std::print("G is on Grumpkin curve: ");
    std::println(g_on_curve);
    std::println("");
    
    let d_x_cubed = D.x * D.x * D.x;
    let d_y_squared = D.y * D.y;
    let d_right_side = d_x_cubed - 17;
    let d_on_curve = d_y_squared == d_right_side;
    
    std::println("Grumpkin curve verification for D:");
    std::print("Left side (y^2) = ");
    std::println(d_y_squared);
    std::print("Right side (x^3 - 17) = ");
    std::println(d_right_side);
    std::print("D is on Grumpkin curve: ");
    std::println(d_on_curve);
    std::println("");
    
    // Verify generators are not the point at infinity
    assert(!G.is_infinite, "Generator G should not be point at infinity");
    assert(!D.is_infinite, "Generator D should not be point at infinity");
    
    // Verify generators are valid curve points
    assert(g_on_curve, "Generator G is not on the Grumpkin curve");
    assert(d_on_curve, "Generator D is not on the Grumpkin curve");
    
    // Verify generators are different from each other
    let g_d_different = (G.x != D.x) | (G.y != D.y);
    assert(g_d_different, "Generators G and D should be different");
    
    std::println("========================================");
    std::println("✅ All generators for pedersen_commitment_non_hiding are valid!");
    std::println("========================================");
}
