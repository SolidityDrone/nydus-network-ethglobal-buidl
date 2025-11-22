/**
 * Dynamic wrapper for Nydus utilities
 * Loads the ESM modules at runtime to bypass ts-node compilation issues
 */

import { logger } from '../utils/logger';

export const NYDUS_MESSAGE = "Welcome to the Nydus! \n\nThis signature on this message will be used to access the Nydus network. This signature is your access key to the network and needed for clientside proving. \nMake sure you don't pass this signature to someone else! \n\nCaution: Please make sure that the domain you are connected to is correct.";

/**
 * Compute private key from signature using dynamic import
 */
export async function computePrivateKeyFromSignature(signature: string): Promise<bigint> {
  try {
    // Dynamic import at runtime (not at compile time)
    const aztecCrypto = await eval(`import('@aztec/foundation/crypto')`);
    const { poseidon2Hash } = aztecCrypto;

    // Convert signature hex string to Buffer
    const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
    const sigBuffer = Buffer.from(sigHex, 'hex');

    if (sigBuffer.length !== 65) {
      throw new Error(`Signature must be 65 bytes, got ${sigBuffer.length}`);
    }

    // Split into chunks
    const chunk1 = sigBuffer.subarray(0, 31);
    const chunk2 = sigBuffer.subarray(31, 62);
    const chunk3 = sigBuffer.subarray(62, 65);

    const chunk1BigInt = BigInt('0x' + chunk1.toString('hex'));
    const chunk2BigInt = BigInt('0x' + chunk2.toString('hex'));
    const chunk3BigInt = BigInt('0x' + chunk3.toString('hex'));

    // Compute poseidon hash
    const poseidonHash = await poseidon2Hash([chunk1BigInt, chunk2BigInt, chunk3BigInt]);

    // Convert to bigint
    let privateKey: bigint;
    if (typeof poseidonHash === 'bigint') {
      privateKey = poseidonHash;
    } else if ('toBigInt' in poseidonHash && typeof (poseidonHash as any).toBigInt === 'function') {
      privateKey = (poseidonHash as any).toBigInt();
    } else if ('value' in poseidonHash) {
      privateKey = BigInt((poseidonHash as any).value);
    } else {
      privateKey = BigInt((poseidonHash as any).toString());
    }

    logger.debug('Private key computed from signature', {
      privateKeyHex: '0x' + privateKey.toString(16).slice(0, 16) + '...'
    });

    return privateKey;
  } catch (error) {
    logger.error('Error computing private key from signature', { error });
    throw error;
  }
}

/**
 * Generate public key from private key using dynamic import
 */
export async function generatePublicKey(privateKey: bigint): Promise<{ x: bigint; y: bigint }> {
  try {
    // Dynamic import at runtime
    const curves = await eval(`import('@noble/curves/misc.js')`);
    const { babyjubjub } = curves;

    const BASE8_X = BigInt('5299619240641551281634865583518297030282874472190772894086521144482721001553');
    const BASE8_Y = BigInt('16950150798460657717958625567821834550301663161624707787222815936182638968203');

    const BASE8 = babyjubjub.Point.fromAffine({ x: BASE8_X, y: BASE8_Y });
    const publicKeyPoint = BASE8.multiply(privateKey);

    return { x: publicKeyPoint.x, y: publicKeyPoint.y };
  } catch (error) {
    logger.error('Error generating public key', { error });
    throw error;
  }
}

/**
 * Check if Nydus position is initialized
 */
export async function isNydusInitialized(publicKeyX: bigint, publicKeyY: bigint): Promise<boolean> {
  // For now, return false to skip initialization
  // TODO: Implement actual contract call
  return false;
}

/**
 * Initialize Nydus position
 * Generates proof using nydus_entry circuit and submits to contract
 */
export async function initializeNydusPosition(
  privateKey: bigint,
  publicKey: { x: bigint; y: bigint }
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Dynamic import of the actual implementation from nydus-utils
    const nydusUtils = await import('./nydus-utils');
    return await nydusUtils.initializeNydusPosition(privateKey, publicKey);
  } catch (error) {
    logger.error('Error in initializeNydusPosition wrapper', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create deposit to Nydus
 * Generates proof and submits to contract
 */
export async function depositToNydus(
  privateKey: bigint,
  tokenAddress: string,
  amount: bigint,
  fromAddress: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // Dynamic import of the actual implementation from nydus-utils
    const nydusUtils = await import('./nydus-utils');
    return await nydusUtils.depositToNydus(privateKey, tokenAddress, amount, fromAddress);
  } catch (error) {
    logger.error('Error in depositToNydus wrapper', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

