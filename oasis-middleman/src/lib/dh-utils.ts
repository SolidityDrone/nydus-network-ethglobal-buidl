const { poseidon2Hash } = require('@aztec/foundation/crypto');
const { babyjubjub } = require('@noble/curves/misc.js');

/**
 * TypeScript implementation of Diffie-Hellman key exchange
 * that matches the Noir implementation in nydus-send/src/main.nr
 * 
 * Uses BN254/Baby Jubjub curve and Poseidon2 hashing
 */

export interface Point {
  x: bigint;
  y: bigint;
}

export interface KeyPair {
  privateKey: bigint;
  publicKey: Point;
}

export interface DHResult {
  senderPublicKey: Point;
  sharedKey: bigint;
}

/**
 * Convert bigint to Uint8Array (32 bytes)
 */
function bigintToUint8Array(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0'); // 32 bytes = 64 hex chars
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Generate public key from private key using Baby Jubjub curve
 */
export function generatePublicKey(privateKey: bigint): Point {
  console.log('Generating public key for private key:', privateKey.toString(16));

  // Use BASE8 (also called Base8), which is the standard base point for Baby Jubjub
  // BASE8 = 8 * Generator
  // Coordinates from: https://eips.ethereum.org/EIPS/eip-2494
  const BASE8_X = BigInt('5299619240641551281634865583518297030282874472190772894086521144482721001553');
  const BASE8_Y = BigInt('16950150798460657717958625567821834550301663161624707787222815936182638968203');

  const BASE8 = babyjubjub.Point.fromAffine({ x: BASE8_X, y: BASE8_Y });
  const publicKeyPoint = BASE8.multiply(privateKey);

  console.log('Generated public key:', publicKeyPoint.x.toString(16), publicKeyPoint.y.toString(16));
  return { x: publicKeyPoint.x, y: publicKeyPoint.y };
}

/**
 * Perform Diffie-Hellman key exchange using Baby Jubjub curve
 */
export async function performDHKeyExchange(
  senderPrivateKey: bigint,
  receiverPublicKey: Point
): Promise<DHResult> {
  // Generate sender's public key: sender_pub_key = sender_private_key * generator
  console.log('Sender private key:', senderPrivateKey.toString(16));
  const senderPublicKey = generatePublicKey(senderPrivateKey);

  // Compute shared secret: shared_secret = sender_private_key * receiver_public_key
  // Create a Point from the receiver's public key using fromAffine
  const receiverPoint = babyjubjub.Point.fromAffine({ x: receiverPublicKey.x, y: receiverPublicKey.y });

  // Multiply the receiver's public key by sender's private key
  const sharedSecret = receiverPoint.multiply(senderPrivateKey);

  // Hash the shared secret using Poseidon2 to get a final shared key
  // This matches: let shared_key = Poseidon2::hash([shared_secret.x, shared_secret.y], 2);
  const sharedKeyFr = await poseidon2Hash([sharedSecret.x, sharedSecret.y]);

  // Convert Fr to bigint - try toBigInt() method first, then fallback to other conversions
  let sharedKey: bigint;
  if (typeof sharedKeyFr === 'bigint') {
    sharedKey = sharedKeyFr;
  } else if ('toBigInt' in sharedKeyFr && typeof (sharedKeyFr as any).toBigInt === 'function') {
    sharedKey = (sharedKeyFr as any).toBigInt();
  } else if ('value' in sharedKeyFr) {
    sharedKey = BigInt((sharedKeyFr as any).value);
  } else {
    sharedKey = BigInt((sharedKeyFr as any).toString());
  }

  return {
    senderPublicKey,
    sharedKey
  };
}

/**
 * Convert hex string to bigint
 */
export function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

/**
 * Convert bigint to hex string
 */
export function bigIntToHex(value: bigint): string {
  return '0x' + value.toString(16);
}

/**
 * Test function to verify DH key exchange matches Noir implementation
 */
export async function testDHKeyExchange(
  aliceUserKey: bigint,
  aliceNonce: bigint,
  bobPublicKeyX: bigint,
  bobPublicKeyY: bigint,
  amount: bigint,
  tokenAddress: bigint
): Promise<DHResult> {
  console.log('=== TypeScript DH Key Exchange Test ===');

  console.log('Alice user key:', bigIntToHex(aliceUserKey));
  console.log('Alice nonce:', bigIntToHex(aliceNonce));
  console.log('Bob public key X:', bigIntToHex(bobPublicKeyX));
  console.log('Bob public key Y:', bigIntToHex(bobPublicKeyY));

  // Perform DH key exchange
  const result = await performDHKeyExchange(aliceUserKey, {
    x: bobPublicKeyX,
    y: bobPublicKeyY
  });

  console.log('Alice sender public key X:', bigIntToHex(result.senderPublicKey.x));
  console.log('Alice sender public key Y:', bigIntToHex(result.senderPublicKey.y));
  console.log('Shared key:', bigIntToHex(result.sharedKey));

  return result;
}