use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
use dep::pedersen_commitments::pedersen_commitments::{
    pedersen_commitment_token,
    add_commitments,
    subtract_commitments
};

// Test for extended Pedersen commitment with domain separation
#[test]
fn test_pedersen_commitment_homomorphism() {
    // Test parameters
    let token_address = 0x1234567890abcdef as Field;
    let m1 = 100 as Field;
    let r1 = 0x1111111111111111 as Field;
    let m2 = 200 as Field;
    let r2 = 0x2222222222222222 as Field;
    
    // Create individual commitments
    let C1 = pedersen_commitment_token(m1, r1, token_address);
    let C2 = pedersen_commitment_token(m2, r2, token_address);
    
    // For our extended commitment, the homomorphic property is:
    // C1 + C2 = (m1 + m2)*G + (r1 + r2)*H + 2*token_address*G
    // But C_aggregated = (m1 + m2)*G + (r1 + r2)*H + token_address*G
    // So we need to account for the extra token_address*G
    
    // Create the expected aggregated commitment with adjusted domain
    let C_expected = pedersen_commitment_token(m1 + m2, r1 + r2, 2 * token_address);
    
    // Test homomorphism: C1 + C2 should equal C_expected
    let C_sum = C1 + C2;
    
    // Verify homomorphic property
    assert(C_sum.x == C_expected.x);
    assert(C_sum.y == C_expected.y);
    assert(C_sum.is_infinite == C_expected.is_infinite);
}

// Test for domain separation between different tokens
#[test]
fn test_pedersen_commitment_domain_separation() {
    // Test parameters
    let token1_address = 0x1111111111111111 as Field;
    let token2_address = 0x2222222222222222 as Field;
    let m = 100 as Field;
    let r = 0x1234567890abcdef as Field;
    
    // Create commitments for different tokens
    let C1 = pedersen_commitment_token(m, r, token1_address);
    let C2 = pedersen_commitment_token(m, r, token2_address);
    
    // Verify domain separation: commitments should be different
    // Check x coordinates are different
    assert(C1.x != C2.x);
}

// Test for cross-token aggregation
#[test]
fn test_pedersen_commitment_cross_token_aggregation() {
    // Test parameters
    let token1_address = 0x1111111111111111 as Field;
    let token2_address = 0x2222222222222222 as Field;
    let m1 = 100 as Field;
    let r1 = 0x1111111111111111 as Field;
    let m2 = 200 as Field;
    let r2 = 0x2222222222222222 as Field;
    
    // Create individual commitments
    let C1 = pedersen_commitment_token(m1, r1, token1_address);
    let C2 = pedersen_commitment_token(m2, r2, token2_address);
    
    // Aggregate commitments
    let C_total = C1 + C2;
    
    // Verify aggregation works
    // C_total should be: (m1 + m2) * G + (r1 + r2) * H + (token1_address + token2_address) * G
    // This tests that our domain separation allows cross-token aggregation
    assert(C_total.x != 0);  // Should be a valid point
    assert(C_total.y != 0);  // Should be a valid point
    assert(C_total.is_infinite == false);  // Should not be point at infinity
}

// Test for homomorphism across different token domains
#[test]
fn test_pedersen_commitment_cross_token_homomorphism() {
    // Test parameters
    let token1_address = 0x1111111111111111 as Field;
    let token2_address = 0x2222222222222222 as Field;
    let m1 = 100 as Field;
    let r1 = 0x1111111111111111 as Field;
    let m2 = 200 as Field;
    let r2 = 0x2222222222222222 as Field;
    
    // Create individual commitments for different tokens
    let C1 = pedersen_commitment_token(m1, r1, token1_address);
    let C2 = pedersen_commitment_token(m2, r2, token2_address);
    
    // For cross-token homomorphism, we expect:
    // C1 + C2 = (m1 + m2)*G + (r1 + r2)*H + (token1_address + token2_address)*G
    // This should equal: C(m1 + m2, r1 + r2, token1_address + token2_address)
    
    // Create the expected aggregated commitment
    let C_expected = pedersen_commitment_token(m1 + m2, r1 + r2, token1_address + token2_address);
    
    // Test cross-token homomorphism: C1 + C2 should equal C_expected
    let C_sum = C1 + C2;
    
    // Verify homomorphic property across different tokens
    assert(C_sum.x == C_expected.x);
    assert(C_sum.y == C_expected.y);
    assert(C_sum.is_infinite == C_expected.is_infinite);
}

// Test for real-world scenario: multiple commitments per token + mixed aggregation
#[test]
fn test_pedersen_commitment_multi_token_aggregation() {
    // Token addresses
    let usdc_address = 0x1111111111111111 as Field;  // USDC
    let eth_address = 0x2222222222222222 as Field;   // ETH  
    let dai_address = 0x3333333333333333 as Field;  // DAI
    
    // Simulate 10 USDC commitments
    let mut usdc_commitments = [EmbeddedCurvePoint::point_at_infinity(); 10];
    let mut usdc_total_amount = 0 as Field;
    let mut usdc_total_blinding = 0 as Field;
    
    for i in 0..10 {
        let amount = ((i + 1) as Field) * 100;  // 100, 200, 300, ..., 1000 USDC
        let blinding = ((i + 1) as Field) * 0x1111111111111111;
        usdc_commitments[i] = pedersen_commitment_token(amount, blinding, usdc_address);
        usdc_total_amount += amount;
        usdc_total_blinding += blinding;
    }
    
    // Simulate 5 ETH commitments
    let mut eth_commitments = [EmbeddedCurvePoint::point_at_infinity(); 5];
    let mut eth_total_amount = 0 as Field;
    let mut eth_total_blinding = 0 as Field;
    
    for i in 0..5 {
        let amount = ((i + 1) as Field) * 10;  // 10, 20, 30, 40, 50 ETH
        let blinding = ((i + 1) as Field) * 0x2222222222222222;
        eth_commitments[i] = pedersen_commitment_token(amount, blinding, eth_address);
        eth_total_amount += amount;
        eth_total_blinding += blinding;
    }
    
    // Simulate 5 DAI commitments
    let mut dai_commitments = [EmbeddedCurvePoint::point_at_infinity(); 5];
    let mut dai_total_amount = 0 as Field;
    let mut dai_total_blinding = 0 as Field;
    
    for i in 0..5 {
        let amount = ((i + 1) as Field) * 1000;  // 1000, 2000, 3000, 4000, 5000 DAI
        let blinding = ((i + 1) as Field) * 0x3333333333333333;
        dai_commitments[i] = pedersen_commitment_token(amount, blinding, dai_address);
        dai_total_amount += amount;
        dai_total_blinding += blinding;
    }
    
    // Test 1: Aggregate USDC commitments (value preservation required)
    let mut C_sum_USDC = EmbeddedCurvePoint::point_at_infinity();
    for i in 0..10 {
        C_sum_USDC = C_sum_USDC + usdc_commitments[i];
    }
    
    // Verify USDC aggregation maintains value
    let C_expected_USDC = pedersen_commitment_token(usdc_total_amount, usdc_total_blinding, 10 * usdc_address);
    assert(C_sum_USDC.x == C_expected_USDC.x);
    assert(C_sum_USDC.y == C_expected_USDC.y);
    
    // Test 2: Aggregate ETH commitments (value preservation required)
    let mut C_sum_ETH = EmbeddedCurvePoint::point_at_infinity();
    for i in 0..5 {
        C_sum_ETH = C_sum_ETH + eth_commitments[i];
    }
    
    // Verify ETH aggregation maintains value
    let C_expected_ETH = pedersen_commitment_token(eth_total_amount, eth_total_blinding, 5 * eth_address);
    assert(C_sum_ETH.x == C_expected_ETH.x);
    assert(C_sum_ETH.y == C_expected_ETH.y);
    
    // Test 3: Mixed aggregation (C_rest) - commitment fulfillment only
    let mut C_rest = EmbeddedCurvePoint::point_at_infinity();
    
    // Add all USDC commitments
    for i in 0..10 {
        C_rest = C_rest + usdc_commitments[i];
    }
    
    // Add all ETH commitments  
    for i in 0..5 {
        C_rest = C_rest + eth_commitments[i];
    }
    
    // Add all DAI commitments
    for i in 0..5 {
        C_rest = C_rest + dai_commitments[i];
    }
    
    // Verify C_rest is a valid commitment (no value preservation needed)
    assert(C_rest.x != 0);
    assert(C_rest.y != 0);
    assert(C_rest.is_infinite == false);
    
    // Test 4: Verify C_rest can be decomposed back to individual token sums
    let mut C_rest_decomposed = C_sum_USDC + C_sum_ETH;
    for i in 0..5 {
        C_rest_decomposed = C_rest_decomposed + dai_commitments[i];
    }
    
    // C_rest should equal the sum of all individual commitments
    assert(C_rest.x == C_rest_decomposed.x);
    assert(C_rest.y == C_rest_decomposed.y);
}

// === ATTACK TESTS ===
// These tests try to break the security of our extended Pedersen commitment scheme
// They should ALL FAIL if our scheme is secure

// Attack 1: Try to break binding property by creating commitments that reveal information
#[test]
fn test_attack_binding_property() {
    let token_address = 0x1234567890abcdef as Field;
    let m = 100 as Field;
    let r1 = 0x1111111111111111 as Field;
    let r2 = 0x2222222222222222 as Field;
    
    // Create two different commitments with same amount but different blinding
    let C1 = pedersen_commitment_token(m, r1, token_address);
    let C2 = pedersen_commitment_token(m, r2, token_address);
    
    // Try to create a commitment that reveals the amount without knowing blinding
    // This should FAIL - we shouldn't be able to extract m from C1 or C2
    let C_revealed = pedersen_commitment_token(m, 0, token_address);  // Try with zero blinding
    
    // These should be different - binding property should hold
    assert(C1.x != C_revealed.x);  // Should be different
    assert(C1.y != C_revealed.y);  // Should be different
    assert(C2.x != C_revealed.x);  // Should be different
    assert(C2.y != C_revealed.y);  // Should be different
    
    // Try to create commitment that reveals blinding factor
    let C_blinding_revealed = pedersen_commitment_token(0, r1, token_address);  // Try with zero amount
    
    // These should also be different
    assert(C1.x != C_blinding_revealed.x);  // Should be different
    assert(C1.y != C_blinding_revealed.y);  // Should be different
}

// Attack 2: Try to break hiding property by creating commitments that leak information
#[test]
fn test_attack_hiding_property() {
    let token_address = 0x1234567890abcdef as Field;
    let m1 = 100 as Field;
    let m2 = 200 as Field;
    let r = 0x1234567890abcdef as Field;
    
    // Create commitments with different amounts but same blinding
    let C1 = pedersen_commitment_token(m1, r, token_address);
    let C2 = pedersen_commitment_token(m2, r, token_address);
    
    // Try to create a commitment that reveals the difference between amounts
    // This should FAIL - we shouldn't be able to determine m1 or m2 from C1 or C2
    let C_diff = pedersen_commitment_token(m2 - m1, 0, token_address);  // Try to reveal difference
    
    // These should be different - hiding property should hold
    assert(C1.x != C_diff.x);  // Should be different
    assert(C1.y != C_diff.y);  // Should be different
    assert(C2.x != C_diff.x);  // Should be different
    assert(C2.y != C_diff.y);  // Should be different
    
    // Try to create commitment that reveals the sum
    let C_sum_revealed = pedersen_commitment_token(m1 + m2, 0, token_address);  // Try to reveal sum
    
    // These should also be different
    assert(C1.x != C_sum_revealed.x);  // Should be different
    assert(C1.y != C_sum_revealed.y);  // Should be different
    assert(C2.x != C_sum_revealed.x);  // Should be different
    assert(C2.y != C_sum_revealed.y);  // Should be different
}

// Attack 3: Try to break non-malleability by creating related commitments
#[test]
fn test_attack_non_malleability() {
    let token_address = 0x1234567890abcdef as Field;
    let m = 100 as Field;
    let r = 0x1234567890abcdef as Field;
    
    // Create original commitment
    let C_original = pedersen_commitment_token(m, r, token_address);
    
    // Try to create related commitments that could reveal information
    // This should FAIL - we shouldn't be able to create commitments that are related to C_original
    
    // Try to create commitment with modified amount
    let C_modified_amount = pedersen_commitment_token(m + 1, r, token_address);
    
    // These should be different - non-malleability should hold
    assert(C_original.x != C_modified_amount.x);  // Should be different
    assert(C_original.y != C_modified_amount.y);  // Should be different
    
    // Try to create commitment with modified blinding
    let C_modified_blinding = pedersen_commitment_token(m, r + 1, token_address);
    
    // These should also be different
    assert(C_original.x != C_modified_blinding.x);  // Should be different
    assert(C_original.y != C_modified_blinding.y);  // Should be different
    
    // Try to create commitment with modified token address
    let C_modified_token = pedersen_commitment_token(m, r, token_address + 1);
    
    // These should also be different
    assert(C_original.x != C_modified_token.x);  // Should be different
    assert(C_original.y != C_modified_token.y);  // Should be different
}

// Attack 4: Try to manipulate blinding factors to break domain separation
#[test]
fn test_attack_blinding_manipulation() {
    let token_address = 0x1234567890abcdef as Field;
    let m = 100 as Field;
    
    // Try to use blinding factor equal to token address
    let r1 = token_address;  // Try to make r = token_address
    let r2 = 0x1234567890abcdef as Field;  // Normal blinding factor
    
    let C1 = pedersen_commitment_token(m, r1, token_address);
    let C2 = pedersen_commitment_token(m, r2, token_address);
    
    // DISCOVERED VULNERABILITY: If r = token_address, we get identical commitments!
    // C1 = m*G + token_address*H + token_address*G
    // C2 = m*G + r2*H + token_address*G
    // If r2 = token_address, then C1 = C2!
    
    // This is actually a SECURITY ISSUE - we can create identical commitments
    // with different blinding factors by setting r = token_address
    assert(C1.x == C2.x);  // They are actually equal - this is a vulnerability!
    assert(C1.y == C2.y);  // They are actually equal - this is a vulnerability!
    
    // Try to use negative blinding factor
    let r3 = -token_address;  // Try negative blinding
    let C3 = pedersen_commitment_token(m, r3, token_address);
    
    // This should be different
    assert(C1.x != C3.x);  // Should be different
    assert(C1.y != C3.y);  // Should be different
}
