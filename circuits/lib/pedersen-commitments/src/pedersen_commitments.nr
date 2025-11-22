use dep::std;
use dep::std::embedded_curve_ops::{EmbeddedCurvePoint, EmbeddedCurveScalar, multi_scalar_mul};

global NULLIFIER_DOMAIN_SEPARATOR: Field 
    = 0x100000000000000000000000000000000000000000000000000000000000000;

global COUNTER_DOMAIN_SEPARATOR: Field 
    = 0x200000000000000000000000000000000000000000000000000000000000000;


pub fn pedersen_commitment_token(m: Field, r: Field, token_address: Field) -> EmbeddedCurvePoint {
    // Use derive_generators to get different generators for G and H
    let generators: [EmbeddedCurvePoint; 3] =
        std::hash::derive_generators("PEDERSEN_COMMITMENT".as_bytes(), 0);
    
    let G = generators[0];  // First generator for amount
    let H = generators[1];  // Second generator for blinding factor
    let D = generators[2];  // Third generator for domain separation
     // Create scalars for multi_scalar_mul
    let mut scalars = [EmbeddedCurveScalar { lo: 0, hi: 0 }; 3];
    scalars[0] = from_field(m);
    scalars[1] = from_field(r);
    scalars[2] = from_field(token_address);
    
    // Create points for multi_scalar_mul: [G, H, D]
    let mut points = [EmbeddedCurvePoint::point_at_infinity(); 3];
    points[0] = G;
    points[1] = H;
    points[2] = D;  
    
    // Compute commitment: m*G + r*H + token_address*D
    multi_scalar_mul(points, scalars)
}

pub fn pedersen_commitment_non_hiding(m: Field, token_address: Field) -> EmbeddedCurvePoint {
    let generators: [EmbeddedCurvePoint; 3] =
        std::hash::derive_generators("PEDERSEN_COMMITMENT_PERSONAL".as_bytes(), 0);
    
    let G = generators[0];  // 
    let D = generators[1];  // 
     // Create scalars for multi_scalar_mul
    let mut scalars = [EmbeddedCurveScalar { lo: 0, hi: 0 }; 2];
    scalars[0] = from_field(m);
    scalars[1] = from_field(token_address);
    
    // Create points for multi_scalar_mul: [G, H, D]
    let mut points = [EmbeddedCurvePoint::point_at_infinity(); 2];
    points[0] = G;
    points[1] = D;
    
    // Compute commitment: m*G + r*H + token_address*D
    multi_scalar_mul(points, scalars)
}



pub fn to_negative_domain(token_address: Field) -> Field {
    token_address + NULLIFIER_DOMAIN_SEPARATOR
}

pub fn to_nullifier_domain(token_address: Field) -> Field {
    token_address + NULLIFIER_DOMAIN_SEPARATOR
}



// === DOMAIN SEPARATION FOR negative/positive ===
// Creates distinct commitment spaces for the same token

pub fn pedersen_commitment_negative(m: Field, r: Field, token_address: Field, mult: Field) -> EmbeddedCurvePoint {
    // negative space: add 1 to the most significant bit
    // 0x00000000000000000000000058002bee8f43bf203964d38c54fa03e62d615959fa
    // becomes 0x10000000000000000000000058002bee8f43bf203964d38c54fa03e62d615959fa
    let negative_domain = token_address + NULLIFIER_DOMAIN_SEPARATOR;
    pedersen_commitment_token(m, r, negative_domain * mult)
}

pub fn pedersen_commitment_counter(m: Field, r: Field, token_address: Field) -> EmbeddedCurvePoint {
    // negative space: add 1 to the most significant bit
    // 0x00000000000000000000000058002bee8f43bf203964d38c54fa03e62d615959fa
    // becomes 0x20000000000000000000000058002bee8f43bf203964d38c54fa03e62d615959fa
    let counter_domain = token_address + COUNTER_DOMAIN_SEPARATOR;
    pedersen_commitment_token(m, r, counter_domain)
}


pub fn pedersen_commitment_positive(m: Field, r: Field, token_address: Field) -> EmbeddedCurvePoint {
    // positive space: token_address (original)
    // 0x00000000000000000000000058002bee8f43bf203964d38c54fa03e62d615959fa
    pedersen_commitment_token(m, r, token_address)
}

// === COMMITMENT VERIFICATION ===

pub fn verify_commitment_opening(commitment: EmbeddedCurvePoint, m: Field, r: Field, token_address: Field) -> bool {
    let computed_commitment = pedersen_commitment_token(m, r, token_address);
    let x_equal = computed_commitment.x == commitment.x;
    let y_equal = computed_commitment.y == commitment.y;
    x_equal & y_equal
}

pub fn verify_negative_commitment_opening(commitment: EmbeddedCurvePoint, m: Field, r: Field, token_address: Field, mult: Field) -> bool {
    let computed_commitment = pedersen_commitment_negative(m, r, token_address, mult);
    let x_equal = computed_commitment.x == commitment.x;
    let y_equal = computed_commitment.y == commitment.y;
    x_equal & y_equal
}

pub fn verify_positive_commitment_opening(commitment: EmbeddedCurvePoint, m: Field, r: Field, token_address: Field) -> bool {
    let computed_commitment = pedersen_commitment_positive(m, r, token_address);
    let x_equal = computed_commitment.x == commitment.x;
    let y_equal = computed_commitment.y == commitment.y;
    x_equal & y_equal
}

// === COMMITMENT ARITHMETIC ===

pub fn add_commitments(c1: EmbeddedCurvePoint, c2: EmbeddedCurvePoint) -> EmbeddedCurvePoint {
    c1 + c2
}

pub fn add_multiple_commitments(commitments: [EmbeddedCurvePoint]) -> EmbeddedCurvePoint {
    let mut result = EmbeddedCurvePoint::point_at_infinity();
    
    for i in 0..commitments.len() {
        if i == 0 {
            result = commitments[i];
        } else {
            result = result + commitments[i];
        }
    }
    
    result
}

pub fn subtract_commitments(c1: EmbeddedCurvePoint, c2: EmbeddedCurvePoint) -> EmbeddedCurvePoint {
    // c1 - c2 = c1 + (-c2)
    let neg_c2 = -c2;
    c1 + neg_c2
}


// === BALANCE VERIFICATION ===
// Proves that negative commitments >= positive commitments

pub fn verify_balance_proof(
    negative_commitment: EmbeddedCurvePoint,
    positive_commitment: EmbeddedCurvePoint,
    total_commitment: EmbeddedCurvePoint,
    negative_m: Field,
    negative_r: Field,
    positive_m: Field,
    positive_r: Field,
    token_address: Field
) -> bool {
    // Verify commitment openings
    let negative_valid = verify_negative_commitment_opening(negative_commitment, negative_m, negative_r, token_address, 1);
    let positive_valid = verify_positive_commitment_opening(positive_commitment, positive_m, positive_r, token_address);
    
    // Verify arithmetic: negative + positive = total
    let sum_commitment = add_commitments(negative_commitment, positive_commitment);
    let x_equal = sum_commitment.x == total_commitment.x;
    let y_equal = sum_commitment.y == total_commitment.y;
    let arithmetic_valid = x_equal & y_equal;
    
    // Verify sufficient balance: negative_m >= positive_m
    let balance_valid = (negative_m as u128) >= (positive_m as u128);
    
    ((negative_valid as u1) & (positive_valid as u1) & (arithmetic_valid as u1) & (balance_valid as u1)) as bool
}

// === UTILITY FUNCTIONS ===


global TWO_POW_128: Field = 0x100000000000000000000000000000000;

fn compute_decomposition(x: Field) -> (Field, Field) {
    // Here's we're taking advantage of truncating 128 bit limbs from the input field
    // and then subtracting them from the input such the field division is equivalent to integer division.
    let low = (x as u128) as Field;
    let high = (x - low) / TWO_POW_128;

    (low, high)
}

fn from_field(scalar: Field) -> EmbeddedCurveScalar {
    // Safety: xlo and xhi decomposition is checked below
    let (xlo, xhi) = compute_decomposition(scalar);
    // Check that the decomposition is correct
    assert_eq(scalar, xlo + TWO_POW_128 * xhi);
    EmbeddedCurveScalar { lo: xlo, hi: xhi }
}
