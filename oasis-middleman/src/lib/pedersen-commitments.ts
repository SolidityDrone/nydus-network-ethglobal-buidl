/**
 * TypeScript implementation of pedersen_commitment_non_hiding
 * Matches the Noir implementation in circuits/lib/pedersen-commitments/src/pedersen_commitments.nr
 * 
 * Uses Grumpkin curve (BN254 scalar field) with generators G and D
 * Commitment: m*G + token_address*D
 */

// Don't import poseidon2Hash at top level - import dynamically after Buffer polyfill

// Grumpkin curve field modulus (BN254 scalar field)
const GRUMPKIN_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

// Hardcoded generators matching Noir's derive_generators("PEDERSEN_COMMITMENT", 0)
// Used for pedersen_commitment_positive, pedersen_commitment_negative, etc.
// Generator G (first generator for amount)
const GENERATOR_G = {
  x: BigInt('0x25630136fe1c61cbfaf1c6acb59edd53cebf87d0dc341132a6a2af3c077afb4f'),
  y: BigInt('0x0ebe7c8574896e51ac5d1140a74e3d4cbda2b338c4e2a9f1e1e94dca28a60747')
};

// Generator H (second generator for blinding factor)
const GENERATOR_H = {
  x: BigInt('0x25edc94b5b4b8bdb0601895d7d51a098ee051e4aed3837b23b2f7510893d613d'),
  y: BigInt('0x18dfd2d181d3272513698220ac5fb371004335ffa6702aade8b647dbe0b3dce1')
};

// Generator D (third generator for domain separation)
const GENERATOR_D = {
  x: BigInt('0x02b0b4e69873f1551d49f57e25b587289ce25cf5f641722ec1d8fa44495eff81'),
  y: BigInt('0x19ac5f9bd16c9dedfd6cc4384e2105c1a87ec67974c83b52c4a2846d093d21d2')
};

// Hardcoded generators matching Noir's derive_generators("PEDERSEN_COMMITMENT_PERSONAL", 0)
// Used for pedersen_commitment_non_hiding
// Generator G_PERSONAL (for m/amount)
const GENERATOR_G_PERSONAL = {
  x: BigInt('0x06b0fc2fb449823a0d49e53c9430c82c3e01d9a3f6db0d2e24b8e7c5f8d1899c'),
  y: BigInt('0x10affc120285b6213e315acd916ba137464ba4f0fa22ddf2e17d92d0273e810a')
};

// Generator D_PERSONAL (for token_address/domain separation)
const GENERATOR_D_PERSONAL = {
  x: BigInt('0x0f5c1a8bc1a944ba846fd82d761beefc1e9be60231957fbebc546748524932be'),
  y: BigInt('0x26eb0172758293804416aa211812abb25e70e275c7df20c4f34dc814bf87c757')
};

// NULLIFIER_DOMAIN_SEPARATOR from pedersen_commitments.nr
const NULLIFIER_DOMAIN_SEPARATOR = BigInt('0x100000000000000000000000000000000000000000000000000000000000000');

export interface GrumpkinPoint {
  x: bigint;
  y: bigint;
}

/**
 * Add two Grumpkin curve points
 * Curve equation: y^2 = x^3 - 17 (mod p)
 */
function grumpkinAdd(p1: GrumpkinPoint, p2: GrumpkinPoint): GrumpkinPoint {
  const p = GRUMPKIN_FIELD_MODULUS;

  // Ensure all values are BigInt
  const x1 = typeof p1.x === 'bigint' ? p1.x : BigInt(p1.x);
  const y1 = typeof p1.y === 'bigint' ? p1.y : BigInt(p1.y);
  const x2 = typeof p2.x === 'bigint' ? p2.x : BigInt(p2.x);
  const y2 = typeof p2.y === 'bigint' ? p2.y : BigInt(p2.y);

  // Handle point at infinity (0, 0)
  if (x1 === BigInt(0) && y1 === BigInt(0)) return { x: x2, y: y2 };
  if (x2 === BigInt(0) && y2 === BigInt(0)) return { x: x1, y: y1 };

  // Handle negation: if p2 is the negation of p1, result is point at infinity
  if (x1 === x2 && y1 === (p - y2) % p) {
    return { x: BigInt(0), y: BigInt(0) };
  }

  // Same point: use tangent formula
  if (x1 === x2 && y1 === y2) {
    // Slope = (3*x^2) / (2*y)
    const numerator = (BigInt(3) * x1 * x1) % p;
    const denominator = (BigInt(2) * y1) % p;
    const invDenominator = modInverse(denominator, p);
    const slope = (numerator * invDenominator) % p;

    const x3 = (slope * slope - BigInt(2) * x1) % p;
    const y3 = (slope * (x1 - x3) - y1) % p;
    return { x: x3 < BigInt(0) ? x3 + p : x3, y: y3 < BigInt(0) ? y3 + p : y3 };
  }

  // Different points: use secant formula
  const xDiff = (x2 - x1 + p) % p;
  const yDiff = (y2 - y1 + p) % p;
  const invXDiff = modInverse(xDiff, p);
  const slope = (yDiff * invXDiff) % p;

  const x3 = (slope * slope - x1 - x2) % p;
  const y3 = (slope * (x1 - x3) - y1) % p;
  return { x: x3 < BigInt(0) ? x3 + p : x3, y: y3 < BigInt(0) ? y3 + p : y3 };
}

/**
 * Scalar multiplication on Grumpkin curve: k * P
 */
function grumpkinMul(point: GrumpkinPoint, scalar: bigint): GrumpkinPoint {
  const p = GRUMPKIN_FIELD_MODULUS;
  // Ensure scalar is BigInt
  const scalarBigInt = typeof scalar === 'bigint' ? scalar : BigInt(scalar);
  // Ensure point coordinates are BigInt
  const x = typeof point.x === 'bigint' ? point.x : BigInt(point.x);
  const y = typeof point.y === 'bigint' ? point.y : BigInt(point.y);
  const normalizedPoint: GrumpkinPoint = { x, y };

  let result: GrumpkinPoint = { x: BigInt(0), y: BigInt(0) }; // Point at infinity
  let temp = normalizedPoint;
  let k = scalarBigInt % p;

  while (k > BigInt(0)) {
    if (k & BigInt(1)) {
      result = grumpkinAdd(result, temp);
    }
    temp = grumpkinAdd(temp, temp);
    k = k >> BigInt(1);
  }

  return result;
}

/**
 * Modular inverse using Fermat's little theorem: a^(-1) = a^(p-2) mod p
 */
function modInverse(a: bigint, p: bigint): bigint {
  if (a === BigInt(0)) throw new Error('Cannot compute inverse of 0');
  return modPow(a, p - BigInt(2), p);
}

/**
 * Modular exponentiation: base^exp mod mod
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BigInt(1);
  base = base % mod;
  while (exp > BigInt(0)) {
    if (exp & BigInt(1)) {
      result = (result * base) % mod;
    }
    exp = exp >> BigInt(1);
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Negate a Grumpkin point: -P = (x, -y mod p)
 */
function grumpkinNegate(point: GrumpkinPoint): GrumpkinPoint {
  const p = GRUMPKIN_FIELD_MODULUS;
  // Ensure all values are BigInt
  const x = typeof point.x === 'bigint' ? point.x : BigInt(point.x);
  const y = typeof point.y === 'bigint' ? point.y : BigInt(point.y);
  return {
    x: x,
    y: (p - y) % p
  };
}

/**
 * Subtract two Grumpkin points: P1 - P2 = P1 + (-P2)
 */
export function grumpkinSubtract(p1: GrumpkinPoint, p2: GrumpkinPoint): GrumpkinPoint {
  return grumpkinAdd(p1, grumpkinNegate(p2));
}

/**
 * Add two Grumpkin points (exported for use in hooks)
 */
export function grumpkinAddPoints(p1: GrumpkinPoint, p2: GrumpkinPoint): GrumpkinPoint {
  return grumpkinAdd(p1, p2);
}

/**
 * Compute to_nullifier_domain(token_address)
 * Returns: token_address + NULLIFIER_DOMAIN_SEPARATOR
 */
export function toNullifierDomain(tokenAddress: bigint): bigint {
  const p = GRUMPKIN_FIELD_MODULUS;
  const tokenAddressField = tokenAddress % p;
  return (tokenAddressField + NULLIFIER_DOMAIN_SEPARATOR) % p;
}

/**
 * Compute pedersen_commitment_non_hiding(m, token_address)
 * Matches: pedersen_commitment_non_hiding(m: Field, token_address: Field) -> EmbeddedCurvePoint
 * 
 * Uses generators from "PEDERSEN_COMMITMENT_PERSONAL" domain (NOT "PEDERSEN_COMMITMENT")
 * Returns: m*G_PERSONAL + token_address*D_PERSONAL
 */
export function pedersenCommitmentNonHiding(m: bigint, tokenAddress: bigint): GrumpkinPoint {
  const p = GRUMPKIN_FIELD_MODULUS;

  // Ensure values are in field
  const mField = m % p;
  const tokenAddressField = tokenAddress % p;

  // Compute m*G_PERSONAL (using generators from PEDERSEN_COMMITMENT_PERSONAL domain)
  const mG = grumpkinMul(GENERATOR_G_PERSONAL, mField);

  // Compute token_address*D_PERSONAL (using generators from PEDERSEN_COMMITMENT_PERSONAL domain)
  const tokenD = grumpkinMul(GENERATOR_D_PERSONAL, tokenAddressField);

  // Add them: m*G_PERSONAL + token_address*D_PERSONAL
  return grumpkinAdd(mG, tokenD);
}

/**
 * Aggregate opening values using BN254 scalar field addition
 * Matches the contract's aggregateOpeningValue function
 * Uses BN254 scalar field modulus: 21888242871839275222246405745257275088548364400416034343698204186575808495617
 */
export function aggregateOpeningValue(current: bigint, newValue: bigint): bigint {
  // BN254 scalar field modulus (BN256 scalar field)
  const BN254_SCALAR_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

  // Field addition: (current + newValue) mod PRIME
  const sum = (current + newValue) % BN254_SCALAR_FIELD_MODULUS;
  return sum;
}

/**
 * Check if two Grumpkin points are equal
 */
export function grumpkinPointEqual(p1: GrumpkinPoint, p2: GrumpkinPoint): boolean {
  return p1.x === p2.x && p1.y === p2.y;
}

/**
 * TypeScript implementation of pedersen_commitment_positive
 * Matches: pedersen_commitment_positive(m: Field, r: Field, token_address: Field) -> EmbeddedCurvePoint
 * 
 * This uses pedersen_commitment_token which uses 3 generators (G, H, D)
 * Formula: m*G + r*H + token_address*D
 */
export function pedersenCommitmentPositive(m: bigint, r: bigint, tokenAddress: bigint): GrumpkinPoint {
  // Full 3-generator version: m*G + r*H + token_address*D
  const mG = grumpkinMul(GENERATOR_G, m);
  const rH = grumpkinMul(GENERATOR_H, r);
  const tokenD = grumpkinMul(GENERATOR_D, tokenAddress);

  // Add all three: mG + rH + tokenD
  return grumpkinAdd(grumpkinAdd(mG, rH), tokenD);
}

